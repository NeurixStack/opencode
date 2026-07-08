export * as SessionTelemetry from "./session"

import { Context, Effect, Option } from "effect"
import type { AnySpan, Span, SpanLink } from "effect/Tracer"
import { DisablePropagation, ParentSpan } from "effect/Tracer"

// undefined inherits the ambient parent during resume; null explicitly detaches execution.
export const TraceParent = Context.Reference<AnySpan | null | undefined>("@opencode/SessionTelemetry/TraceParent", {
  defaultValue: () => undefined,
})

export const TraceLinks = Context.Reference<ReadonlyArray<SpanLink>>("@opencode/SessionTelemetry/TraceLinks", {
  defaultValue: () => [],
})

export const TurnLinks = Context.Reference<
  { readonly previous: () => Span | undefined; readonly set: (span: Span) => void } | undefined
>("@opencode/SessionTelemetry/TurnLinks", { defaultValue: () => undefined })

export function makeExecution<Key>() {
  const turnCapacity = 1_024
  const parents = new Map<Key, AnySpan | null>()
  const links = new Map<Key, ReadonlyArray<SpanLink>>()
  const turns = new Map<Key, Span>()
  const turnLinks = (key: Key) => ({
    previous: () => {
      const span = turns.get(key)
      if (!span) return
      turns.delete(key)
      turns.set(key, span)
      return span
    },
    set: (span: Span) => {
      turns.delete(key)
      turns.set(key, span)
      if (turns.size <= turnCapacity) return
      const oldest = turns.keys().next()
      if (!oldest.done) turns.delete(oldest.value)
    },
  })
  const drain = <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) => {
    const parent = parents.get(key) ?? null
    const observed = effect.pipe(
      Effect.provideService(TraceParent, parent),
      Effect.provideService(TraceLinks, links.get(key) ?? []),
      Effect.provideService(TurnLinks, turnLinks(key)),
    )
    return parent === null ? observed : observed.pipe(Effect.withParentSpan(parent, { captureStackTrace: false }))
  }
  const resume = <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const override = yield* TraceParent
      const ambient = Option.getOrUndefined(yield* Effect.serviceOption(ParentSpan))
      const inherited = ambient && !Context.get(ambient.annotations, DisablePropagation) ? ambient : undefined
      const parent = override === null ? null : (override ?? inherited ?? null)
      if (!parents.has(key)) {
        parents.set(key, parent)
        links.set(key, yield* TraceLinks)
      }
      return yield* effect
    })
  const settled = (key: Key) =>
    Effect.sync(() => {
      parents.delete(key)
      links.delete(key)
    })
  return { drain, resume, settled }
}

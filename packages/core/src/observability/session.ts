export * as SessionTelemetry from "./session"

import { Context, Effect, Option } from "effect"
import type { AnySpan } from "effect/Tracer"
import { ParentSpan } from "effect/Tracer"

// undefined inherits the ambient parent, null explicitly detaches background work.
export const TraceParent = Context.Reference<AnySpan | null | undefined>("@opencode/SessionTelemetry/TraceParent", {
  defaultValue: () => undefined,
})

export function makeExecution<Key>() {
  const parents = new Map<Key, AnySpan>()
  const drain = <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) => {
    const parent = parents.get(key)
    const observed = effect.pipe(Effect.provideService(TraceParent, parent))
    return parent === undefined ? observed : observed.pipe(Effect.withParentSpan(parent, { captureStackTrace: false }))
  }
  const resume = <A, E, R>(key: Key, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const override = yield* TraceParent
      const ambient = Option.getOrUndefined(yield* Effect.serviceOption(ParentSpan))
      const parent = override === null ? undefined : (override ?? ambient)
      if (parent !== undefined && !parents.has(key)) parents.set(key, parent)
      return yield* effect
    })
  const settled = (key: Key) => Effect.sync(() => parents.delete(key)).pipe(Effect.asVoid)
  return { drain, resume, settled }
}

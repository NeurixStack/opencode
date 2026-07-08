export * as LLMHttpTelemetry from "./http"

import { Cause, Clock, Context, Effect, Exit, Option, References, Stream } from "effect"
import { ParentSpan, type Span } from "effect/Tracer"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_OPENCODE_ERROR_SOURCE,
  ATTR_OPENCODE_ERROR_STAGE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_SCHEME,
} from "../semconv"
import { LLMError } from "../schema"

export const RequestIssued = Context.Reference<((time: bigint) => Effect.Effect<void>) | undefined>(
  "@opencode/LLM/Telemetry/RequestIssued",
  { defaultValue: () => undefined },
)

export const ResponseReceived = Context.Reference<((status: number) => Effect.Effect<void>) | undefined>(
  "@opencode/LLM/Telemetry/ResponseReceived",
  { defaultValue: () => undefined },
)

export const ResponseChunkReceived = Context.Reference<Effect.Effect<void> | undefined>(
  "@opencode/LLM/Telemetry/ResponseChunkReceived",
  { defaultValue: () => undefined },
)

const observe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchCauseIf(
    effect,
    (cause) => !Cause.hasInterrupts(cause),
    () => Effect.void,
  )

export const stream = <A, R>(request: HttpClientRequest.HttpClientRequest, source: Stream.Stream<A, LLMError, R>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const parent = Option.getOrUndefined(yield* Effect.serviceOption(ParentSpan))
      if (parent?._tag !== "Span") return source
      const url = URL.canParse(request.url) ? new URL(request.url) : undefined
      const port = url?.port
        ? Number(url.port)
        : url?.protocol === "https:"
          ? 443
          : url?.protocol === "http:"
            ? 80
            : undefined
      const span = yield* Effect.makeSpan(request.method, {
        kind: "client",
        parent,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: request.method,
          ...(url
            ? {
                [ATTR_SERVER_ADDRESS]: url.hostname,
                ...(port === undefined ? {} : { [ATTR_SERVER_PORT]: port }),
                [ATTR_URL_FULL]: safeUrl(url),
                [ATTR_URL_PATH]: url.pathname,
                [ATTR_URL_SCHEME]: url.protocol.slice(0, -1),
              }
            : {}),
        },
      })
      const state: State = { ended: false, responseReceived: false }
      yield* Effect.addFinalizer((exit) => observe(finalize(span, state, exit)))
      return observeStream(span, state, source)
    }).pipe(
      Effect.withTracerEnabled(true),
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.succeed(source),
      ),
    ),
  )

type State = {
  ended: boolean
  responseReceived: boolean
  terminal?: Exit.Exit<void, unknown>
}

function observeStream<A, R>(span: Span, state: State, source: Stream.Stream<A, LLMError, R>) {
  const terminate = (exit: Exit.Exit<void, unknown>, type?: string) => {
    if (state.terminal) return
    state.terminal = exit
    if (type) span.attribute(ATTR_ERROR_TYPE, type)
  }
  return Stream.concat(source, Stream.fromEffect(Effect.sync(() => (state.ended = true))).pipe(Stream.drain)).pipe(
    Stream.onStart(
      observe(
        Effect.gen(function* () {
          const requestIssued = yield* RequestIssued
          if (requestIssued) yield* requestIssued(yield* Clock.currentTimeNanos)
        }),
      ),
    ),
    Stream.tapCause((cause) =>
      observe(
        Effect.gen(function* () {
          const error = Option.getOrUndefined(Cause.findErrorOption(cause))
          if (Cause.hasInterruptsOnly(cause)) {
            terminate(Exit.failCause(cause))
            return
          }
          const type = error?.reason._tag ?? "unknown"
          const status = error && "http" in error.reason ? error.reason.http?.response?.status : undefined
          if (status !== undefined) span.attribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status)
          span.attribute(
            ATTR_OPENCODE_ERROR_SOURCE,
            error?.reason._tag === "Transport"
              ? "transport"
              : error?.reason._tag === "InvalidProviderOutput"
                ? "protocol"
                : "provider",
          )
          span.attribute(
            ATTR_OPENCODE_ERROR_STAGE,
            status !== undefined ? "response" : state.responseReceived ? "response_stream" : "request",
          )
          terminate(Exit.fail(new Error(type)), type)
        }),
      ),
    ),
    Stream.provideService(ParentSpan, span),
    Stream.provideService(ResponseReceived, (status) =>
      Effect.sync(() => {
        state.responseReceived = true
        span.attribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status)
      }),
    ),
    Stream.provideService(HttpClient.TracerDisabledWhen, () => true),
    Stream.provideService(HttpClient.TracerPropagationEnabled, false),
    Stream.provideService(References.TracerEnabled, false),
  )
}

function finalize(span: Span, state: State, scopeExit: Exit.Exit<unknown, unknown>) {
  return Effect.gen(function* () {
    if (!state.terminal) {
      state.terminal = state.ended
        ? Exit.void
        : Exit.isFailure(scopeExit)
          ? Exit.failCause(scopeExit.cause)
          : Exit.void
    }
    span.end(yield* Clock.currentTimeNanos, state.terminal)
  })
}

export function safeUrl(url: URL) {
  const safe = new URL(url)
  safe.username = ""
  safe.password = ""
  for (const key of safe.searchParams.keys()) {
    if (/(?:api[-_]?key|token|secret|signature|credential|password|authorization|auth)/i.test(key))
      safe.searchParams.set(key, "[REDACTED]")
  }
  safe.hash = ""
  return safe.toString()
}

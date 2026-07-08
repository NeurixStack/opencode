export * as ServerObservability from "./observability"

import { Cause, Effect, Layer, Option } from "effect"
import { HttpMiddleware } from "effect/unstable/http"

export const httpTracingDisabled = Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)

export function locationLayer<A, E, R>(layer: Layer.Layer<A, E, R>, sessionID: string) {
  return layer.pipe(Layer.tapCause((cause) => locationFailure(cause, sessionID, "load")))
}

export function locationFailure(cause: Cause.Cause<unknown>, sessionID: string, phase: "resolve" | "load") {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  const log = error && typeof error === "object" && "_tag" in error && error._tag === "SessionNotFoundError"
    ? Effect.logWarning
    : Effect.logError
  return log("Failed to resolve Session location", cause).pipe(
    Effect.annotateLogs({
      operation: "session.location",
      phase,
      sessionID,
      errorType: errorType(cause),
    }),
  )
}

function errorType(cause: Cause.Cause<unknown>) {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (error && typeof error === "object" && "_tag" in error && typeof error._tag === "string") return error._tag
  const failure = Cause.squash(cause)
  return failure instanceof Error ? failure.name : "unknown"
}

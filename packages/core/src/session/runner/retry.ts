export * as SessionRunnerRetry from "./retry"

import { LLMError } from "@opencode-ai/llm"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Data, Duration, Effect, Schedule } from "effect"
import { EventV2 } from "../../event"
import { AgentTelemetry } from "../../observability/agent"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { SessionRunner } from "./index"

export const maxAttempts = 5

export class RetryableFailure extends Data.TaggedError("SessionRunner.RetryableFailure")<{
  readonly cause: LLMError
  readonly assistantMessageID: SessionMessage.ID
  readonly error: SessionError.Error
  readonly step: number
}> {}

export function isRetryable(error: LLMError) {
  switch (error.reason._tag) {
    case "RateLimit":
    case "ProviderInternal":
    case "Transport":
      return true
    case "Authentication":
    case "QuotaExceeded":
    case "ContentPolicy":
    case "InvalidProviderOutput":
    case "InvalidRequest":
    case "NoRoute":
    case "UnknownProvider":
      return false
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}

const retryAfter = (failure: RetryableFailure) => {
  if (failure.cause.reason._tag === "RateLimit" || failure.cause.reason._tag === "ProviderInternal")
    return failure.cause.reason.retryAfterMs
  return undefined
}

export const schedule = (events: EventV2.Interface, sessionID: SessionSchema.ID) =>
  Schedule.exponential("2 seconds").pipe(
    Schedule.take(maxAttempts - 1),
    Schedule.setInputType<RetryableFailure | SessionRunner.RunError>(),
    Schedule.passthrough,
    Schedule.while(({ input }) => input instanceof RetryableFailure),
    Schedule.modifyDelay((failure, delay) => {
      const minimum = failure instanceof RetryableFailure ? retryAfter(failure) : undefined
      return Effect.succeed(minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum)))
    }),
    Schedule.tap((metadata) => {
      const failure = metadata.input
      if (!(failure instanceof RetryableFailure)) return Effect.void
      return Effect.gen(function* () {
        yield* events.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: failure.assistantMessageID,
          attempt: metadata.attempt + 1,
          at: metadata.now + Duration.toMillis(metadata.duration),
          error: failure.error,
        })
        yield* AgentTelemetry.retryScheduled({
          attempt: metadata.attempt + 1,
          maxAttempts,
          delayMs: Duration.toMillis(metadata.duration),
          retryAfterMs: retryAfter(failure),
          errorType: failure.error.type,
        })
      })
    }),
  )

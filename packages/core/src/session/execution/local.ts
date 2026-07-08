import { Cause, Effect, Exit, Layer } from "effect"
import { EventV2 } from "../../event"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionEvent } from "../event"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { toSessionError } from "../to-session-error"
import { UserInterruptedError } from "../error"
import { SessionTelemetry } from "../../observability/session"

export function terminal(exit: Exit.Exit<void, SessionRunner.RunError>, reason?: "user" | "shutdown" | "superseded") {
  if (Exit.isSuccess(exit)) return { type: "succeeded" as const }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted" as const, reason: reason ?? "shutdown" }
  const failure = Cause.squash(exit.cause)
  if (failure instanceof UserInterruptedError) return { type: "interrupted" as const, reason: "user" as const }
  return { type: "failed" as const, error: toSessionError(failure) }
}

function errorType(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.name : "unknown"
}

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const telemetry = SessionTelemetry.makeExecution<SessionSchema.ID>()
    const reportLifecycle = <A>(sessionID: SessionSchema.ID, phase: string, effect: Effect.Effect<A>) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to publish Session execution lifecycle", cause).pipe(
                Effect.annotateLogs({
                  operation: "session.execution.lifecycle",
                  phase,
                  sessionID,
                  errorType: errorType(cause),
                }),
              ),
        ),
        Effect.asVoid,
      )
    const coordinator = yield* SessionRunCoordinator.make<
      SessionSchema.ID,
      SessionRunner.RunError,
      "user" | "shutdown" | "superseded"
    >({
      started: (sessionID) =>
        reportLifecycle(sessionID, "started", events.publish(SessionEvent.Execution.Started, { sessionID })),
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
        const drain = SessionRunner.Service.use((runner) => runner.drain({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(
                  Effect.annotateLogs({
                    operation: "session.execution.drain",
                    sessionID,
                    errorType: toSessionError(Cause.squash(cause)).type,
                  }),
                ),
          ),
        )
        return yield* telemetry.drain(sessionID, drain)
      }),
      // One terminal observation per busy period, covering every coalesced drain.
      settled: (sessionID, exit, reason) => {
        const outcome = terminal(exit, reason)
        return reportLifecycle(
          sessionID,
          outcome.type,
          Effect.gen(function* () {
            if (outcome.type === "succeeded") {
              yield* events.publish(SessionEvent.Execution.Succeeded, { sessionID })
              return
            }
            if (outcome.type === "interrupted") {
              yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: outcome.reason })
              return
            }
            yield* events.publish(SessionEvent.Execution.Failed, {
              sessionID,
              error: outcome.error,
            })
          }),
        ).pipe(Effect.ensuring(telemetry.settled(sessionID)))
      },
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: (sessionID) => coordinator.interrupt(sessionID, "user"),
      resume: (sessionID) => telemetry.resume(sessionID, coordinator.run(sessionID)),
      wake: coordinator.wake,
      awaitIdle: coordinator.awaitIdle,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"

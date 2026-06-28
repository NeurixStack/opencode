export * as SessionRuntimeCoordinator from "./runtime-coordinator"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { SessionRunner } from "./runner"
import { SessionRunCoordinator } from "./run-coordinator"
import { SessionSchema } from "./schema"

type Drain = (force: boolean) => Effect.Effect<void, SessionRunner.RunError>

export interface Interface {
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly run: (sessionID: SessionSchema.ID, drain: Drain) => Effect.Effect<void, SessionRunner.RunError>
  readonly wake: (sessionID: SessionSchema.ID, drain: Drain) => Effect.Effect<void>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRuntimeCoordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const drains = new Map<SessionSchema.ID, Drain>()
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID, force) {
        const drain = drains.get(sessionID)
        if (!drain) return yield* Effect.die(`No SessionRuntime drain registered for ${sessionID}`)
        return yield* drain(force)
      }),
    })

    return Service.of({
      active: coordinator.active,
      run: (sessionID, drain) =>
        Effect.sync(() => drains.set(sessionID, drain)).pipe(Effect.andThen(coordinator.run(sessionID))),
      wake: (sessionID, drain) =>
        Effect.sync(() => drains.set(sessionID, drain)).pipe(Effect.andThen(coordinator.wake(sessionID))),
      interrupt: coordinator.interrupt,
      wait: coordinator.awaitIdle,
    })
  }),
)

export const defaultLayer = layer

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

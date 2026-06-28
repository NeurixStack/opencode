export * as SessionRuntime from "./runtime"

import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Location } from "../location"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionInput } from "./input"
import { SessionRevert } from "./revert"
import { SessionRunner } from "./runner"
import * as SessionRunnerLLM from "./runner/llm"
import { SessionRuntimeCoordinator } from "./runtime-coordinator"
import { SessionSchema } from "./schema"
import { Snapshot } from "../snapshot"
import { FSUtil } from "../fs-util"
import { makeLocationNode } from "../effect/app-node"
import { SessionV2 } from "../session"
import {
  BusyError,
  MessageNotFoundError,
  NotFoundError,
  PromptConflictError,
  type RevertState,
} from "../session"

export interface Interface {
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      files?: boolean
    }) => Effect.Effect<RevertState, NotFoundError | MessageNotFoundError | BusyError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | BusyError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | BusyError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRuntime") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const sessions = yield* SessionV2.Service
    const runner = yield* SessionRunner.Service
    const snapshot = yield* Snapshot.Service
    const coordinator = yield* SessionRuntimeCoordinator.Service

    const local = Effect.fn("SessionRuntime.local")(function* (sessionID: SessionSchema.ID) {
      const session = yield* sessions.get(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* new NotFoundError({ sessionID })
      return session
    })

    const drain = (sessionID: SessionSchema.ID) =>
      Effect.fnUntraced(function* (force: boolean) {
        yield* local(sessionID).pipe(Effect.orDie)
        return yield* runner.run({ sessionID, force })
      })

    return Service.of({
      prompt: Effect.fn("SessionRuntime.prompt")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* local(input.sessionID)
            const prompt = resolvePrompt(input.prompt)
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery = input.delivery ?? "steer"
            const expected = { sessionID: input.sessionID, messageID, prompt, delivery }
            const admitted = yield* SessionInput.admit(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              prompt,
              delivery,
            }).pipe(
              Effect.catchDefect((defect) =>
                defect instanceof SessionInput.LifecycleConflict
                  ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                  : Effect.die(defect),
              ),
            )
            if (!SessionInput.equivalent(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* coordinator.wake(admitted.sessionID, drain(admitted.sessionID))
            return admitted
          }),
        ),
      ),
      wait: Effect.fn("SessionRuntime.wait")(function* (sessionID) {
        yield* local(sessionID)
        yield* coordinator.wait(sessionID)
      }),
      active: coordinator.active,
      resume: Effect.fn("SessionRuntime.resume")(function* (sessionID) {
        yield* local(sessionID)
        yield* coordinator.run(sessionID, drain(sessionID))
      }),
      interrupt: Effect.fn("SessionRuntime.interrupt")(function* (sessionID) {
        yield* local(sessionID)
        yield* Effect.uninterruptible(coordinator.interrupt(sessionID))
      }),
      revert: {
        stage: Effect.fn("SessionRuntime.revert.stage")(function* (input) {
          const session = yield* local(input.sessionID)
          if ((yield* coordinator.active).has(input.sessionID)) return yield* new BusyError({ sessionID: input.sessionID })
          return yield* SessionRevert.stage({ session, messageID: input.messageID, files: input.files }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.provideService(EventV2.Service, events),
            Effect.provideService(Snapshot.Service, snapshot),
          )
        }),
        clear: Effect.fn("SessionRuntime.revert.clear")(function* (sessionID) {
          const session = yield* local(sessionID)
          if ((yield* coordinator.active).has(sessionID)) return yield* new BusyError({ sessionID })
          return yield* SessionRevert.clear(session).pipe(
            Effect.provideService(EventV2.Service, events),
            Effect.provideService(Snapshot.Service, snapshot),
          )
        }),
        commit: Effect.fn("SessionRuntime.revert.commit")(function* (sessionID) {
          const session = yield* local(sessionID)
          if ((yield* coordinator.active).has(sessionID)) return yield* new BusyError({ sessionID })
          return yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, events))
        }),
      },
    })
  }),
)

const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    agents: input.agents,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, Location.node, SessionV2.node, SessionRunnerLLM.node, Snapshot.node, SessionRuntimeCoordinator.node],
})

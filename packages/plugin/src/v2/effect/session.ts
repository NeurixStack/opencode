import type { Effect } from "effect"
import type { PromptInput, SessionInputAdmitted, SessionMessage, SessionV2Info } from "@opencode-ai/sdk/v2/types"

export interface SessionDomain {
  readonly create: (input: {
    readonly id?: string
    readonly parentID?: string
    readonly title?: string
    readonly agent?: string
    readonly model?: SessionV2Info["model"]
  }) => Effect.Effect<SessionV2Info, unknown>
  readonly get: (sessionID: string) => Effect.Effect<SessionV2Info, unknown>
  readonly messages: (input: {
    readonly sessionID: string
    readonly limit?: number
    readonly order?: "asc" | "desc"
    readonly cursor?: { readonly id: string; readonly direction: "previous" | "next" }
  }) => Effect.Effect<ReadonlyArray<SessionMessage>, unknown>
  readonly context: (sessionID: string) => Effect.Effect<ReadonlyArray<SessionMessage>, unknown>
  readonly prompt: (input: {
    readonly id?: string
    readonly sessionID: string
    readonly prompt: PromptInput
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }) => Effect.Effect<SessionInputAdmitted, unknown>
  readonly resume: (sessionID: string) => Effect.Effect<void, unknown>
  readonly wait: (sessionID: string) => Effect.Effect<void, unknown>
  readonly interrupt: (sessionID: string) => Effect.Effect<void, unknown>
}

import type { PromptInput, SessionInputAdmitted, SessionMessage, SessionV2Info } from "@opencode-ai/sdk/v2/types"

export interface SessionDomain {
  readonly create: (input: {
    readonly id?: string
    readonly parentID?: string
    readonly title?: string
    readonly agent?: string
    readonly model?: SessionV2Info["model"]
  }) => Promise<SessionV2Info>
  readonly get: (sessionID: string) => Promise<SessionV2Info>
  readonly messages: (input: {
    readonly sessionID: string
    readonly limit?: number
    readonly order?: "asc" | "desc"
    readonly cursor?: { readonly id: string; readonly direction: "previous" | "next" }
  }) => Promise<ReadonlyArray<SessionMessage>>
  readonly context: (sessionID: string) => Promise<ReadonlyArray<SessionMessage>>
  readonly prompt: (input: {
    readonly id?: string
    readonly sessionID: string
    readonly prompt: PromptInput
    readonly delivery?: "steer" | "queue"
    readonly resume?: boolean
  }) => Promise<SessionInputAdmitted>
  readonly resume: (sessionID: string) => Promise<void>
  readonly wait: (sessionID: string) => Promise<void>
  readonly interrupt: (sessionID: string) => Promise<void>
}

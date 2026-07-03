export * as Vcs from "./vcs.js"

import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Mode } from "@opencode-ai/schema/vcs"
import { Schema, type Effect, type Scope } from "effect"

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Vcs.RegistrationError", {
  type: Schema.String,
  message: Schema.String,
}) {}

export interface AdapterScope {
  readonly directory: string
  readonly worktree: string
  readonly store: string
}

export interface Adapter {
  readonly status: () => Effect.Effect<readonly FileStatus[]>
  readonly diff: (
    mode: Mode,
    options?: { readonly context?: number },
  ) => Effect.Effect<readonly FileDiff.Info[]>
}

export interface Backend {
  readonly type: string
  readonly make: (scope: AdapterScope) => Adapter
}

export interface VcsDomain {
  readonly register: (backend: Backend) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

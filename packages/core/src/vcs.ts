export * as Vcs from "./vcs"

import { Context, Effect, Layer } from "effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Mode } from "@opencode-ai/schema/vcs"
import { makeLocationNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { AppProcess } from "./process"
import { VcsBackends } from "./vcs/backends"
import { VcsGit } from "./vcs/git"
import { VcsHg } from "./vcs/hg"

export { FileStatus, Mode }

export interface DiffOptions {
  readonly context?: number
}

export interface Interface {
  readonly status: () => Effect.Effect<readonly FileStatus[]>
  readonly diff: (mode: Mode, options?: DiffOptions) => Effect.Effect<readonly FileDiff.Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Vcs") {}

const builtIn = (proc: AppProcess.Interface, fs: FSUtil.Interface, location: Location.Interface) => {
  const scope = { directory: location.directory, worktree: location.project.directory }
  if (location.vcsBackend?.type === "git") return VcsGit.make(proc, scope)
  if (location.vcsBackend?.type === "hg") return VcsHg.make(proc, fs, scope)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const backends = yield* VcsBackends.Service
    const native = builtIn(proc, fs, location)
    let warned = false

    const adapter = Effect.fnUntraced(function* () {
      if (native) return native
      if (!location.vcsBackend) return undefined
      const plugin = backends.get(location.vcsBackend.type)
      if (!plugin && !warned) {
        warned = true
        yield* Effect.logWarning("vcs backend declared but not registered", { type: location.vcsBackend.type })
      }
      return plugin
    })

    return Service.of({
      status: Effect.fn("Vcs.status")(function* () {
        const impl = yield* adapter()
        if (!impl) return []
        return yield* impl.status()
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode, options?: DiffOptions) {
        const impl = yield* adapter()
        if (!impl) return []
        return yield* impl.diff(mode, options)
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer,
  deps: [AppProcess.node, FSUtil.node, Location.node, VcsBackends.node],
})

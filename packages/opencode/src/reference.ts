export * as Reference from "./reference"

import * as InstanceState from "@/effect/instance-state"
import { Config } from "@/config/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { ProjectReference } from "@opencode-ai/core/project-reference"
import { ConfigReference } from "@opencode-ai/core/config/reference"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Context, Effect, Layer, Schema } from "effect"

export type Resolved = ProjectReference.Resolved

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Resolved[]>
  readonly get: (name: string) => Effect.Effect<Resolved | undefined>
  readonly ensure: (target?: string) => Effect.Effect<void>
  readonly contains: (target?: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Reference") {}

export function resolve(input: {
  name: string
  reference: ConfigReference.NormalizedEntry
  directory: string
  worktree: string
}) {
  return ProjectReference.resolve({
    name: input.name,
    reference: input.reference,
    directory: input.worktree === "/" ? input.directory : input.worktree,
    home: Global.Path.home,
    repos: Global.Path.repos,
  })
}

export function resolveAll(input: { references: ConfigReference.NormalizedInfo; directory: string; worktree: string }) {
  return ProjectReference.resolveAll({
    references: input.references,
    directory: input.worktree === "/" ? input.directory : input.worktree,
    home: Global.Path.home,
    repos: Global.Path.repos,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const state = yield* InstanceState.make(
      Effect.fn("Reference.state")(function* (ctx) {
        const { Config: ConfigV2 } = yield* Effect.promise(() => import("@opencode-ai/core/config"))
        const cfg = yield* config.get()
        const base = AbsolutePath.make(ctx.worktree === "/" ? ctx.directory : ctx.worktree)
        const layer = ProjectReference.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              FSUtil.defaultLayer,
              Global.defaultLayer,
              RepositoryCache.defaultLayer,
              Layer.succeed(
                Location.Service,
                Location.Service.of({ directory: base, project: { id: ctx.project.id, directory: base } }),
              ),
              Layer.succeed(
                ConfigV2.Service,
                ConfigV2.Service.of({
                  directories: () => Effect.succeed([]),
                  get: () =>
                    Effect.succeed([
                      new ConfigV2.Loaded({
                        source: { type: "memory" },
                        info: Schema.decodeUnknownSync(ConfigV2.Info)({ references: cfg.reference }),
                      }),
                    ]),
                }),
              ),
            ),
          ),
        )
        return Context.get(yield* Layer.build(layer), ProjectReference.Service)
      }),
    )

    const ensure = Effect.fn("Reference.ensure")(function* (target?: string) {
      yield* InstanceState.useEffect(state, (service) => service.ensurePath(target)).pipe(Effect.ignoreCause)
    })

    return Service.of({
      init: Effect.fn("Reference.init")(function* () {
        yield* InstanceState.get(state)
      }),
      list: Effect.fn("Reference.list")(function* () {
        return yield* InstanceState.useEffect(state, (service) => service.list())
      }),
      get: Effect.fn("Reference.get")(function* (name: string) {
        return yield* InstanceState.useEffect(state, (service) => service.get(name))
      }),
      ensure,
      contains: Effect.fn("Reference.contains")(function* (target?: string) {
        return yield* InstanceState.useEffect(state, (service) => service.containsManagedPath(target))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

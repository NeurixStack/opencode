import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { Vcs as PluginVcs } from "@opencode-ai/plugin/v2/effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Vcs } from "@opencode-ai/core/vcs"
import { VcsBackends } from "@opencode-ai/core/vcs/backends"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

const directory = AbsolutePath.make("/repo")

const provide = Effect.provide(
  LayerNode.compile(LayerNode.group([Vcs.node, VcsBackends.node]), [
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory }, { vcs: { type: "fake", store: AbsolutePath.make("/repo/.fake") } }),
        ),
      ),
    ],
  ]),
)

const status = [{ file: "a.txt", additions: 1, deletions: 0, status: "added" as const }]
const diff = [{ file: "a.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" as const }]

const backend = (overrides: Partial<PluginVcs.Adapter> = {}): PluginVcs.Backend => ({
  type: "fake",
  make: () => ({
    status: () => Effect.succeed(status),
    diff: () => Effect.succeed(diff),
    ...overrides,
  }),
})

const register = (input: PluginVcs.Backend) =>
  Effect.gen(function* () {
    const backends = yield* VcsBackends.Service
    return yield* backends.register(input)
  })

describe("VcsBackends", () => {
  it.live("serves status and diff through a registered backend", () =>
    Effect.gen(function* () {
      yield* register(backend())
      const vcs = yield* Vcs.Service
      expect(yield* vcs.status()).toEqual(status)
      expect(yield* vcs.diff("working")).toEqual(diff)
    }).pipe(Effect.scoped, provide),
  )

  it.live("passes the location scope to the adapter factory", () =>
    Effect.gen(function* () {
      let scope: PluginVcs.AdapterScope | undefined
      yield* register({
        type: "fake",
        make: (input) => {
          scope = input
          return backend().make(input)
        },
      })
      yield* (yield* Vcs.Service).status()
      expect(scope).toEqual({ directory: "/repo", worktree: "/repo", store: "/repo/.fake" })
    }).pipe(Effect.scoped, provide),
  )

  it.live("returns empty results when no backend is registered", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      expect(yield* vcs.status()).toEqual([])
      expect(yield* vcs.diff("working")).toEqual([])
    }).pipe(Effect.scoped, provide),
  )

  it.live("frees the type when the registration scope closes", () =>
    Effect.gen(function* () {
      const backends = yield* VcsBackends.Service
      const scope = yield* Scope.make()
      yield* backends.register(backend()).pipe(Scope.provide(scope))
      expect((yield* (yield* Vcs.Service).status()).length).toBe(1)
      yield* Scope.close(scope, Exit.void)
      expect(yield* (yield* Vcs.Service).status()).toEqual([])
      yield* register(backend())
    }).pipe(Effect.scoped, provide),
  )

  it.live("rejects duplicate and reserved types", () =>
    Effect.gen(function* () {
      yield* register(backend())
      const duplicate = yield* register(backend()).pipe(Effect.exit)
      expect(Exit.isFailure(duplicate)).toBe(true)
      const reserved = yield* register({ ...backend(), type: "git" }).pipe(Effect.exit)
      expect(Exit.isFailure(reserved)).toBe(true)
      const invalid = yield* register({ ...backend(), type: "Not A Slug" }).pipe(Effect.exit)
      expect(Exit.isFailure(invalid)).toBe(true)
    }).pipe(Effect.scoped, provide),
  )

  it.live("degrades failing adapters to empty results", () =>
    Effect.gen(function* () {
      yield* register(
        backend({
          status: () => Effect.die(new Error("backend exploded")),
          diff: () => Effect.sync(() => {
            throw new Error("sync explosion")
          }),
        }),
      )
      const vcs = yield* Vcs.Service
      expect(yield* vcs.status()).toEqual([])
      expect(yield* vcs.diff("working")).toEqual([])
    }).pipe(Effect.scoped, provide),
  )

  it.live("drops rows that fail schema validation", () =>
    Effect.gen(function* () {
      yield* register(
        backend({
          status: () => Effect.succeed([{ file: "a.txt", additions: -1, deletions: 0, status: "added" }]),
        }),
      )
      expect(yield* (yield* Vcs.Service).status()).toEqual([])
    }).pipe(Effect.scoped, provide),
  )
})

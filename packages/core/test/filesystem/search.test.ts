import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer, Scope } from "effect"
import { FileFinder } from "@ff-labs/fff-bun"
import "@opencode-ai/core/filesystem"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

const withTmp = <A, E, R>(f: (directory: AbsolutePath) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(AbsolutePath.make(tmp.path))))

describe("Ripgrep", () => {
  it.live("globs files as an array", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).glob({ cwd, pattern: "**/*.ts", limit: 10 })
        expect(result.map((item) => item.path)).toEqual([RelativePath.make("src/match.ts")])
      }),
    ),
  )

  it.live("greps files with include filtering", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "skip.txt"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).grep({ cwd, pattern: "needle", include: "*.ts", limit: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]?.entry.path).toBe(RelativePath.make("src/match.ts"))
        expect(result[0]?.submatches[0]?.text).toBe("needle")
      }),
    ),
  )
})

describe("FileSystemSearch", () => {
  it.live("initializes fff on the first search", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        if (!Fff.available()) return
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "hello\n"))
        const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
        const create = FileFinder.create
        const calls = { create: 0, destroy: 0 }
        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            FileFinder.create = (options) => {
              calls.create++
              const result = create(options)
              if (!result.ok) return result
              const destroy = result.value.destroy.bind(result.value)
              result.value.destroy = () => {
                calls.destroy++
                destroy()
              }
              return result
            }
          }),
          () =>
            Effect.gen(function* () {
              yield* Effect.acquireUseRelease(
                Scope.make(),
                (scope) =>
                  Effect.gen(function* () {
                    const context = yield* Layer.buildWithScope(
                      FileSystemSearch.fffLayer.pipe(
                        Layer.provide(
                          Layer.succeed(
                            Location.Service,
                            Location.Service.of(location(Location.Ref.make({ directory }))),
                          ),
                        ),
                      ),
                      scope,
                    )
                    const service = Context.get(context, FileSystemSearch.Service)
                    expect(calls.create).toBe(0)

                    yield* Effect.all(
                      [
                        service.find({ query: "", type: "file", limit: 1 }),
                        service.find({ query: "", type: "file", limit: 1 }),
                      ],
                      { concurrency: "unbounded" },
                    )
                    expect(calls.create).toBe(1)

                    yield* service.find({ query: "", type: "file", limit: 1 })
                    expect(calls.create).toBe(1)
                    expect(calls.destroy).toBe(0)
                  }),
                (scope, exit) => Scope.close(scope, exit),
              )
              expect(calls.destroy).toBe(1)
            }),
          () => Effect.sync(() => (FileFinder.create = create)),
        )
      }),
    ),
  )
})

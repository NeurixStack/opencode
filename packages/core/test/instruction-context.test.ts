import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.buildLayer(FSUtil.node))

function provide(options: {
  global: string
  location: Location.Interface
  filesystem?: FSUtil.Interface
}) {
  const location = LayerNode.make(
    Layer.succeed(Location.Service, Location.Service.of(options.location)),
    [],
  )
  return Effect.provide(
    LayerNode.buildLayer(LayerNode.group([InstructionContext.node(location), SystemContextRegistry.node]), {
      replacements: [
        LayerNode.replace(Global.node, Global.layerWith({ config: options.global })),
        ...(options.filesystem
          ? [LayerNode.replace(FSUtil.node, Layer.succeed(FSUtil.Service, FSUtil.Service.of(options.filesystem)))]
          : []),
      ],
    }),
  )
}

describe("InstructionContext", () => {
  it.live("loads global and upward project AGENTS.md files as one aggregate context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "packages", "core")
          const outside = path.join(tmp.path, "AGENTS.md")
          const globalFile = path.join(global, "AGENTS.md")
          const projectFile = path.join(project, "AGENTS.md")
          const packageFile = path.join(directory, "AGENTS.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(outside, "outside")
            await fs.writeFile(globalFile, "global")
            await fs.writeFile(projectFile, "project")
            await fs.writeFile(packageFile, "package")
          })

          const load = SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            provide({
              global,
              location: location(
                { directory: AbsolutePath.make(directory) },
                { projectDirectory: AbsolutePath.make(project) },
              ),
            }),
          )

          const initialized = yield* SystemContext.initialize(yield* load)
          expect(initialized.baseline).toBe(
            [
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${packageFile}\npackage`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
          )
          expect(initialized.baseline).not.toContain("outside")

          yield* Effect.promise(() => fs.writeFile(packageFile, "changed"))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toMatchObject({
            _tag: "Updated",
            text: expect.stringContaining(`Instructions from: ${packageFile}\nchanged`),
          })

          yield* Effect.promise(() => fs.rm(packageFile))
          const partial = yield* SystemContext.reconcile(yield* load, initialized.snapshot)
          expect(partial).toEqual({
            _tag: "Updated",
            text: [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
            snapshot: expect.any(Object),
          })

          yield* Effect.promise(() => Promise.all([fs.rm(globalFile), fs.rm(projectFile)]))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({
            _tag: "Updated",
            text: "Previously loaded instructions no longer apply.",
            snapshot: {},
          })
        }),
      ),
    ),
  )

  it.live("keeps an empty AGENTS.md as available context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(file, ""))
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            provide({
              global: path.join(tmp.path, "global"),
              location: location({ directory: AbsolutePath.make(tmp.path) }),
            }),
          )

          expect((yield* SystemContext.initialize(context)).baseline).toBe(`Instructions from: ${file}\n`)
        }),
      ),
    ),
  )

  it.effect("preserves admitted instructions while observation is unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        provide({
          global: "/global",
          location: location({ directory: AbsolutePath.make("/repo") }),
          filesystem: { ...fs, up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up" })) },
        }),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: "/repo/AGENTS.md", content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("preserves admitted instructions when a discovered file disappears before read", () =>
    Effect.gen(function* () {
      const file = AbsolutePath.make("/repo/AGENTS.md")
      const fs = yield* FSUtil.Service
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        provide({
          global: "/global",
          location: location({ directory: AbsolutePath.make("/repo") }),
          filesystem: {
            ...fs,
            up: () => Effect.succeed([file]),
            readFileStringSafe: () => Effect.succeed(undefined),
          },
        }),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: file, content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("canonicalizes upward discovery boundaries", () =>
    Effect.gen(function* () {
      let observed: { targets: string[]; start: string; stop?: string } | undefined
      const fs = yield* FSUtil.Service

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        provide({
          global: "/global",
          location: location(
            { directory: AbsolutePath.make("/repo/") },
            { projectDirectory: AbsolutePath.make("/repo") },
          ),
          filesystem: {
            ...fs,
            up: (options) =>
              Effect.sync(() => {
                observed = options
                return []
              }),
          },
        }),
      )

      expect(observed).toEqual({
        targets: ["AGENTS.md"],
        start: FSUtil.resolve("/repo"),
        stop: FSUtil.resolve("/repo"),
      })
    }),
  )

  it.effect("honors the project instruction opt-out", () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      let scanned = false
      process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
      const fs = yield* FSUtil.Service

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        provide({
          global: "/global",
          location: location({ directory: AbsolutePath.make("/repo") }),
          filesystem: { ...fs, up: () => Effect.sync(() => ((scanned = true), [])) },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
            else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
          }),
        ),
      )

      expect(scanned).toBe(false)
    }),
  )

  it.effect("does not discover project instructions outside the canonical project root", () =>
    Effect.gen(function* () {
      let scanned = false
      const fs = yield* FSUtil.Service
      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        provide({
          global: "/global",
          location: location(
            { directory: AbsolutePath.make("/outside") },
            { projectDirectory: AbsolutePath.make("/repo") },
          ),
          filesystem: { ...fs, up: () => Effect.sync(() => ((scanned = true), [])) },
        }),
      )

      expect(scanned).toBe(false)
    }),
  )
})

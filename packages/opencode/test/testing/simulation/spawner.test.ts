import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { InMemoryFs } from "just-bash"
import { SimulationFileSystem } from "../../../src/testing/simulation/filesystem"
import { SimulationSpawner } from "../../../src/testing/simulation/spawner"
import { testEffect } from "../../lib/effect"

const root = "/opencode"
const fs = new InMemoryFs()
const it = testEffect(
  Layer.mergeAll(SimulationFileSystem.layer({ root, fs }), SimulationSpawner.layer({ root, fs })),
)

describe("SimulationSpawner", () => {
  it.effect("runs shell commands through just-bash", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make("printf 'hello' > file.txt && cat file.txt", [], { cwd: root, shell: "/bin/bash" }),
      ).pipe(Effect.scoped)

      expect(yield* Stream.mkString(Stream.decodeText(handle.stdout))).toBe("hello")
      expect(Number(yield* handle.exitCode)).toBe(0)
      expect(yield* Effect.promise(() => fs.readFile("/opencode/file.txt"))).toBe("hello")
    }),
  )

  it.effect("extracts shell command text from -lc", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make("bash", ["-lc", "printf ok"], { cwd: root })).pipe(Effect.scoped)

      expect(yield* Stream.mkString(Stream.decodeText(handle.stdout))).toBe("ok")
      expect(Number(yield* handle.exitCode)).toBe(0)
    }),
  )

  it.effect("fakes git discovery commands", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const [common, topLevel, revision] = yield* Effect.all(
        [
          spawner.spawn(ChildProcess.make("git", ["rev-parse", "--git-common-dir"], { cwd: root })).pipe(Effect.scoped),
          spawner.spawn(ChildProcess.make("git", ["rev-parse", "--show-toplevel"], { cwd: root })).pipe(Effect.scoped),
          spawner.spawn(ChildProcess.make("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: root })).pipe(Effect.scoped),
        ],
        { concurrency: 3 },
      )

      expect(yield* Stream.mkString(Stream.decodeText(common.stdout))).toBe(".git\n")
      expect(yield* Stream.mkString(Stream.decodeText(topLevel.stdout))).toBe("/opencode\n")
      expect(yield* Stream.mkString(Stream.decodeText(revision.stdout))).toBe("0000000000000000000000000000000000000000\n")
    }),
  )

  it.effect("rejects unsupported non-shell commands", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const exit = yield* spawner.spawn(ChildProcess.make("git", ["status"], { cwd: root })).pipe(Effect.scoped, Effect.exit)

      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("rejects shell commands outside the simulation root", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const exit = yield* spawner.spawn(ChildProcess.make("printf blocked", [], { cwd: "/tmp", shell: "/bin/bash" })).pipe(
        Effect.scoped,
        Effect.exit,
      )

      expect(exit._tag).toBe("Failure")
    }),
  )
})

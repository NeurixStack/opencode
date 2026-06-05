import { expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

it.live("init writes JSONL to the default state log file", () =>
  Effect.gen(function* () {
    const log = Global.Path.log
    const file = process.env.OPENCODE_LOG_FILE
    const level = process.env.OPENCODE_LOG_LEVEL
    const print = process.env.OPENCODE_PRINT_LOGS
    yield* Effect.addFinalizer(() => Effect.sync(() => (Global.Path.log = log)))
    const dir = yield* tmpdirScoped()
    Global.Path.log = dir
    restoreEnv("OPENCODE_LOG_FILE", undefined)
    restoreEnv("OPENCODE_LOG_LEVEL", undefined)
    restoreEnv("OPENCODE_PRINT_LOGS", undefined)
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Global.Path.log = log
        restoreEnv("OPENCODE_LOG_FILE", file)
        restoreEnv("OPENCODE_LOG_LEVEL", level)
        restoreEnv("OPENCODE_PRINT_LOGS", print)
        await Log.init({ print: false, level: "DEBUG" })
      }),
    )

    yield* Effect.promise(() => Log.init({ print: false, level: "DEBUG" }))
    Log.create({ service: "log.test.default" }).info("hello", { answer: 42 })

    const record = JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(dir, "log.jsonl"), "utf8")))

    expect(Log.file()).toBe(path.join(dir, "log.jsonl"))
    expect(record.level).toBe("INFO")
    expect(record.message).toBe("hello")
    expect(record.service).toBe("log.test.default")
    expect(record.pid).toBe(process.pid)
    expect(record.fields.answer).toBe(42)
    expect(typeof record.run_id).toBe("string")
    expect(typeof record.process_role).toBe("string")
  }),
)

it.live("env can override file path and log level", () =>
  Effect.gen(function* () {
    const log = Global.Path.log
    const file = process.env.OPENCODE_LOG_FILE
    const level = process.env.OPENCODE_LOG_LEVEL
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Global.Path.log = log
        restoreEnv("OPENCODE_LOG_FILE", file)
        restoreEnv("OPENCODE_LOG_LEVEL", level)
        await Log.init({ print: false, level: "DEBUG" })
      }),
    )

    const dir = yield* tmpdirScoped()
    Global.Path.log = dir
    process.env.OPENCODE_LOG_FILE = path.join(dir, "custom.jsonl")
    process.env.OPENCODE_LOG_LEVEL = "WARN"

    yield* Effect.promise(() => Log.init({ print: false }))
    const logger = Log.create({ service: "log.test.env" })
    logger.info("hidden")
    logger.warn("visible")

    const records = (yield* Effect.promise(() => fs.readFile(path.join(dir, "custom.jsonl"), "utf8")))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(Log.file()).toBe(path.join(dir, "custom.jsonl"))
    expect(records).toHaveLength(1)
    expect(records[0].level).toBe("WARN")
    expect(records[0].message).toBe("visible")
  }),
)

it.live("Effect logger writes annotations into JSONL fields", () =>
  Effect.gen(function* () {
    const log = Global.Path.log
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        Global.Path.log = log
        await Log.init({ print: false, level: "DEBUG" })
      }),
    )

    const dir = yield* tmpdirScoped()
    Global.Path.log = dir
    yield* Effect.promise(() => Log.init({ print: false, level: "DEBUG" }))

    yield* Effect.logInfo("effect hello").pipe(
      Effect.annotateLogs({ service: "log.test.effect", "session.id": "session-1" }),
      Effect.provide(EffectLogger.layer),
    )

    const record = JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(dir, "log.jsonl"), "utf8")))

    expect(record.level).toBe("INFO")
    expect(record.message).toBe("effect hello")
    expect(record.service).toBe("log.test.effect")
    expect(record.fields["session.id"]).toBe("session-1")
  }),
)

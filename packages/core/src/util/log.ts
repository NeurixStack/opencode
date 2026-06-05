export * as Log from "./log"

import path from "path"
import fs from "fs/promises"
import { appendFileSync } from "fs"
import * as Global from "../global"
import { Schema } from "effect"
import { ensureProcessMetadata } from "./opencode-process"

export const Level = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})
export type Level = Schema.Schema.Type<typeof Level>

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}
let level: Level = "INFO"

function shouldLog(input: Level): boolean {
  return levelPriority[input] >= levelPriority[level]
}

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void
  info(message?: any, extra?: Record<string, any>): void
  error(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const loggers = new Map<string, Logger>()

export const Default = create({ service: "default" })

export interface Options {
  print?: boolean
  dev?: boolean
  level?: Level
  file?: string | false
}

let logpath = ""
export function file() {
  return logpath
}
type LogEntry = {
  json: string
  pretty: string
}
let write = (entry: LogEntry) => {
  process.stderr.write(entry.pretty)
}

export async function init(options: Options) {
  level = options.level ?? parseLevel(process.env.OPENCODE_LOG_LEVEL) ?? level
  const print = options.print ?? truthy(process.env.OPENCODE_PRINT_LOGS)
  const configured = options.file ?? process.env.OPENCODE_LOG_FILE
  logpath = configured === false || disabled(configured) ? "" : configured || path.join(Global.Path.log, "log.jsonl")

  if (logpath) await fs.mkdir(path.dirname(logpath), { recursive: true })

  write = (entry) => {
    if (logpath) {
      try {
        appendFileSync(logpath, entry.json)
      } catch {}
    }
    if (print) process.stderr.write(entry.pretty)
  }
}

function formatError(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10
    ? result + " Caused by: " + formatError(error.cause, depth + 1)
    : result
}

let last = Date.now()
export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) {
      return cached
    }
  }

  function build(inputLevel: Level, message: any, extra?: Record<string, any>): LogEntry {
    const ts = new Date()
    const metadata = ensureProcessMetadata("main")
    const fields = Object.fromEntries(
      Object.entries({
        ...tags,
        ...extra,
      })
        .filter((entry) => entry[1] !== undefined && entry[1] !== null)
        .map(([key, value]) => [key, normalize(value)]),
    )
    const service = typeof fields.service === "string" ? fields.service : undefined
    if (service) delete fields.service
    const text = stringifyMessage(message)
    const record = {
      ts: ts.toISOString(),
      level: inputLevel,
      message: text,
      run_id: metadata.runID,
      process_role: metadata.processRole,
      pid: process.pid,
      service,
      fields,
    }
    const diff = ts.getTime() - last
    last = ts.getTime()
    const prefix = Object.entries({ service, ...fields })
      .filter((entry) => entry[1] !== undefined && entry[1] !== null)
      .map(([key, value]) => `${key}=${typeof value === "object" ? safeStringify(value) : value}`)
      .join(" ")
    return {
      json: safeStringify(record) + "\n",
      pretty:
        [inputLevel.padEnd(5), ts.toISOString().split(".")[0], "+" + diff + "ms", prefix, text]
          .filter(Boolean)
          .join(" ") + "\n",
    }
  }
  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("DEBUG")) {
        write(build("DEBUG", message, extra))
      }
    },
    info(message?: any, extra?: Record<string, any>) {
      if (shouldLog("INFO")) {
        write(build("INFO", message, extra))
      }
    },
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("ERROR")) {
        write(build("ERROR", message, extra))
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("WARN")) {
        write(build("WARN", message, extra))
      }
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (service && typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}

function truthy(value: string | undefined) {
  return value?.toLowerCase() === "1" || value?.toLowerCase() === "true"
}

function disabled(value: string | undefined) {
  const lower = value?.toLowerCase()
  return lower === "0" || lower === "false" || lower === "off"
}

function parseLevel(value: string | undefined): Level | undefined {
  if (value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR") return value
  return undefined
}

function stringifyMessage(message: any): string {
  if (message instanceof Error) return formatError(message)
  if (message === undefined) return ""
  if (typeof message === "string") return message
  if (typeof message === "object") return safeStringify(message)
  return String(message)
}

function normalize(value: any): any {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: formatError(value),
      stack: value.stack,
    }
  }
  if (typeof value === "bigint") return value.toString()
  return value
}

function safeStringify(value: any) {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_, item) => {
    if (typeof item === "bigint") return item.toString()
    if (item instanceof Error) return normalize(item)
    if (typeof item === "object" && item !== null) {
      if (seen.has(item)) return "[Circular]"
      seen.add(item)
    }
    return item
  })
}

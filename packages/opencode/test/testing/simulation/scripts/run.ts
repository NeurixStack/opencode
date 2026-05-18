#!/usr/bin/env bun
/**
 * Simulation script runner.
 *
 * Drives a simulation script against a running `bun dev simulate` process via
 * the simulation MCP HTTP endpoint. Loads the script, steps through it in
 * configurable chunks, and checks the in-memory log buffer after each chunk.
 * Stops on the first error (configurable level) and prints the failing entries
 * plus the most recent step that was executed.
 *
 * Usage:
 *   bun test/testing/simulation/scripts/run.ts <script.json> [options]
 *
 * Options:
 *   --mcp <url>            MCP endpoint. Default: http://127.0.0.1:43110/mcp
 *   --chunk <n>            Actions per step batch. Default: 3
 *   --max-steps <n>        Hard cap on step calls. Default: unlimited.
 *   --level <lvl>          Stop on entries at or above this level.
 *                          One of DEBUG | INFO | WARN | ERROR. Default: ERROR.
 *   --message-includes <s> Only stop when matching message substring.
 *   --service-includes <s> Only stop when matching tag.service substring.
 *   --reset                Reset simulation state + restart TUI before loading.
 *   --no-reset             Skip the reset/restart (default).
 *   --keep-going           Don't stop on errors; print them and continue.
 *   --quiet                Suppress per-batch progress output.
 *   --json                 Emit a single JSON summary at the end.
 *   --check-every <n>      Check logs only every N batches. Default: 1.
 *
 * Example:
 *   bun test/testing/simulation/scripts/run.ts patches.json \
 *     --reset --chunk 3 --level ERROR
 */

interface Options {
  scriptPath: string
  mcpUrl: string
  chunk: number
  maxSteps: number
  level: "DEBUG" | "INFO" | "WARN" | "ERROR"
  messageIncludes?: string
  serviceIncludes?: string
  reset: boolean
  keepGoing: boolean
  quiet: boolean
  json: boolean
  checkEvery: number
}

function parseArgs(argv: string[]): Options {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp()
    process.exit(0)
  }
  const out: Options = {
    scriptPath: argv[0]!,
    mcpUrl: "http://127.0.0.1:43110/mcp",
    chunk: 3,
    maxSteps: -1,
    level: "ERROR",
    reset: false,
    keepGoing: false,
    quiet: false,
    json: false,
    checkEvery: 1,
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    switch (a) {
      case "--mcp":
        out.mcpUrl = next()
        break
      case "--chunk":
        out.chunk = Number(next())
        break
      case "--max-steps":
        out.maxSteps = Number(next())
        break
      case "--level": {
        const v = next().toUpperCase()
        if (!["DEBUG", "INFO", "WARN", "ERROR"].includes(v)) {
          throw new Error(`--level must be DEBUG|INFO|WARN|ERROR, got ${v}`)
        }
        out.level = v as Options["level"]
        break
      }
      case "--message-includes":
        out.messageIncludes = next()
        break
      case "--service-includes":
        out.serviceIncludes = next()
        break
      case "--reset":
        out.reset = true
        break
      case "--no-reset":
        out.reset = false
        break
      case "--keep-going":
        out.keepGoing = true
        break
      case "--quiet":
        out.quiet = true
        break
      case "--json":
        out.json = true
        break
      case "--check-every":
        out.checkEvery = Number(next())
        break
      case "--help":
      case "-h":
        printHelp()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }
  return out
}

function printHelp() {
  console.log(`Simulation script runner.

Usage:
  bun run.ts <script.json> [options]

Options:
  --mcp <url>              MCP endpoint (default http://127.0.0.1:43110/mcp)
  --chunk <n>              Actions per step batch (default 3)
  --max-steps <n>          Hard cap on step calls (default unlimited)
  --level <lvl>            Stop level: DEBUG|INFO|WARN|ERROR (default ERROR)
  --message-includes <s>   Only stop when message includes substring
  --service-includes <s>   Only stop when tag.service includes substring
  --reset                  Reset sim state + restart TUI before load
  --no-reset               Skip reset (default)
  --keep-going             Don't stop on errors; continue to end
  --quiet                  Suppress per-batch progress
  --json                   Emit JSON summary at the end
  --check-every <n>        Check logs every N batches (default 1)
`)
}

// ─── MCP client ──────────────────────────────────────────────────────────────

let rpcId = 0

async function mcpCall(mcpUrl: string, name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const text = await response.text()
  // The MCP server may respond with a single JSON line or with SSE-style
  // chunks. Find the first `{"result"` line either way.
  const jsonLine = text
    .split("\n")
    .map((line) => line.replace(/^data:\s*/, ""))
    .find((line) => line.trim().startsWith('{"result"') || line.trim().startsWith('{"error"'))
  if (!jsonLine) throw new Error(`${name}: no JSON-RPC response in:\n${text.slice(0, 500)}`)
  const envelope = JSON.parse(jsonLine)
  if (envelope.error) {
    throw new Error(`${name}: ${envelope.error.message ?? JSON.stringify(envelope.error)}`)
  }
  const content = envelope.result?.content?.[0]?.text
  if (typeof content !== "string") {
    throw new Error(`${name}: unexpected MCP envelope:\n${JSON.stringify(envelope).slice(0, 500)}`)
  }
  // Tool result `text` payloads are JSON-encoded.
  return JSON.parse(content)
}

// ─── Logic ───────────────────────────────────────────────────────────────────

interface LogEntry {
  time: string
  level: "DEBUG" | "INFO" | "WARN" | "ERROR"
  tags: Record<string, unknown>
  message: string
}

async function run(opts: Options) {
  const log = (msg: string) => {
    if (!opts.quiet) console.log(msg)
  }

  if (opts.reset) {
    log("Resetting simulation state...")
    await mcpCall(opts.mcpUrl, "simulation_control_reset")
    log("Restarting TUI...")
    await mcpCall(opts.mcpUrl, "simulation_restart")
  }

  log("Clearing log buffer...")
  await mcpCall(opts.mcpUrl, "simulation_log_clear")

  log(`Loading script: ${opts.scriptPath}`)
  const loaded = await mcpCall(opts.mcpUrl, "simulation_script_load", {
    path: opts.scriptPath,
    replace: true,
  })
  log(`  id=${loaded.id} total=${loaded.total}`)

  const total = loaded.total as number
  let batches = 0
  let cursor = 0
  let stopReason: "completed" | "max-steps" | "error" = "completed"
  let stoppingEntries: LogEntry[] | undefined
  let stoppingExecuted: unknown[] | undefined

  while (cursor < total) {
    if (opts.maxSteps > 0 && batches >= opts.maxSteps) {
      stopReason = "max-steps"
      break
    }

    const step = await mcpCall(opts.mcpUrl, "simulation_script_step", { steps: opts.chunk })
    cursor = step.state.cursor as number
    batches++
    if (!opts.quiet) {
      const lastKinds = (step.executed as { type: string }[]).map((a) => a.type).join(",")
      log(`batch ${batches}: cursor ${cursor}/${total} — ${lastKinds}`)
    }

    if (batches % opts.checkEvery !== 0 && cursor < total) continue

    const logResp = await mcpCall(opts.mcpUrl, "simulation_log_get", {
      level: opts.level,
      ...(opts.messageIncludes ? { messageIncludes: opts.messageIncludes } : {}),
      ...(opts.serviceIncludes ? { serviceIncludes: opts.serviceIncludes } : {}),
    })
    const entries = (logResp.entries ?? []) as LogEntry[]
    if (entries.length > 0) {
      if (opts.keepGoing) {
        if (!opts.quiet) {
          console.log(
            `  ⚠ ${entries.length} ${opts.level} entries — continuing (--keep-going)`,
          )
        }
        // Clear so we only see new ones in subsequent batches.
        await mcpCall(opts.mcpUrl, "simulation_log_clear")
      } else {
        stopReason = "error"
        stoppingEntries = entries
        stoppingExecuted = step.executed
        break
      }
    }
  }

  const status = await mcpCall(opts.mcpUrl, "simulation_script_status")

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          stopReason,
          batches,
          cursor,
          total,
          status: status.status,
          stoppingEntries,
          stoppingExecuted,
        },
        null,
        2,
      ) + "\n",
    )
    return
  }

  console.log()
  console.log(`Stopped: ${stopReason}`)
  console.log(`Batches: ${batches}`)
  console.log(`Cursor:  ${cursor}/${total}`)
  if (stopReason === "error" && stoppingEntries) {
    console.log()
    console.log(`${stoppingEntries.length} ${opts.level} entries — failing batch executed:`)
    console.log(JSON.stringify(stoppingExecuted, null, 2))
    console.log()
    console.log(`${opts.level} entries:`)
    console.log(JSON.stringify(stoppingEntries, null, 2))
    process.exitCode = 1
  }
}

try {
  await run(parseArgs(process.argv.slice(2)))
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

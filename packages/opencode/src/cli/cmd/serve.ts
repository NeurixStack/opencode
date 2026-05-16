import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd, fail } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("socket", {
        type: "string",
        describe: "Unix socket path or Windows named pipe name/path to listen on",
      }),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    if (args.socket) {
      const conflicts = explicitNetworkConflicts()
      if (conflicts.length) yield* fail(`--socket cannot be used with ${conflicts.join(", ")}`)
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = args.socket
      ? yield* Effect.promise(() =>
          Server.listen({ type: "socket", socket: resolveSocketPath(args.socket), cors: opts.cors }),
        )
      : yield* Effect.promise(() => Server.listen(opts))
    if (server.type === "socket") {
      console.log(`opencode server listening on socket ${server.socket}`)
      yield* Effect.never
    }
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})

function resolveSocketPath(input: string) {
  if (process.platform !== "win32") return input
  const lower = input.toLowerCase()
  if (lower.startsWith("\\\\.\\pipe\\") || lower.startsWith("\\\\?\\pipe\\")) return input
  const name = input
    .replace(/^[a-zA-Z]:/, (drive) => drive.slice(0, 1))
    .replace(/[\\/:]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `\\\\.\\pipe\\${name || "opencode"}`
}

function explicitNetworkConflicts() {
  return ["--port", "--hostname", "--mdns", "--mdns-domain"].filter((flag) =>
    process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`)),
  )
}

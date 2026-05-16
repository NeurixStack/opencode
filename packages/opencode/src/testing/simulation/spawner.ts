import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Shell } from "@/shell/shell"
import { Effect, Layer, Sink, Stream } from "effect"
import * as PlatformError from "effect/PlatformError"
import { ChildProcess } from "effect/unstable/process"
import {
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId,
} from "effect/unstable/process/ChildProcessSpawner"
import { Bash, type IFileSystem } from "just-bash"
import path from "path"

export interface Options {
  readonly fs: IFileSystem
  readonly root: string
}

const encoder = new TextEncoder()
const shellNames = new Set(["bash", "dash", "ksh", "sh", "zsh"])

function commandText(command: ChildProcess.StandardCommand) {
  if (command.options.shell) return command.command
  const index = command.args.findIndex((arg) => arg === "-c" || arg === "-lc")
  if (index >= 0) return command.args[index + 1]
}

function isShell(command: ChildProcess.StandardCommand) {
  return Boolean(command.options.shell) || shellNames.has(Shell.name(command.command))
}

function error(method: string, command: ChildProcess.Command, description: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "SimulationSpawner",
    method,
    description,
    pathOrDescriptor: command._tag === "StandardCommand" ? [command.command, ...command.args].join(" ") : "pipeline",
  })
}

function output(value: string) {
  if (!value) return Stream.empty
  return Stream.make(encoder.encode(value))
}

function handle(result: { stdout?: string; stderr?: string; exitCode?: number }) {
  const stdoutText = result.stdout ?? ""
  const stderrText = result.stderr ?? ""
  return makeHandle({
    pid: ProcessId(0),
    stdin: Sink.drain,
    stdout: output(stdoutText),
    stderr: output(stderrText),
    all: output(stdoutText + stderrText),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    exitCode: Effect.succeed(ExitCode(result.exitCode ?? 0)),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
  })
}

function cwd(options: Options, command: ChildProcess.StandardCommand) {
  const root = path.resolve(options.root)
  const resolved = path.resolve(root, command.options.cwd ?? root)
  if (resolved === root || AppFileSystem.contains(root, resolved)) return Effect.succeed(resolved)
  return Effect.fail(error("spawn", command, "Working directory is outside the simulated filesystem root"))
}

export function make(options: Options) {
  const spawn = Effect.fn("SimulationSpawner.spawn")(function* (command: ChildProcess.Command) {
    if (command._tag !== "StandardCommand") return yield* error("spawn", command, "Piped commands are not supported")
    const workingDirectory = yield* cwd(options, command)
    if (Shell.name(command.command) === "git") {
      if (command.args[0] === "rev-parse" && command.args.includes("--git-common-dir")) return handle({ stdout: ".git\n" })
      if (command.args[0] === "rev-parse" && command.args.includes("--show-toplevel")) return handle({ stdout: `${workingDirectory}\n` })
      if (command.args[0] === "rev-parse") return handle({ stdout: "0000000000000000000000000000000000000000\n" })
      if (command.args[0] === "rev-list") return handle({ stdout: "0000000000000000000000000000000000000000\n" })
      if (command.args[0] === "config" && command.args.includes("core.bare")) return handle({ stdout: "false\n" })
    }
    if (!isShell(command)) return yield* error("spawn", command, "Only shell commands are supported in simulation")

    const text = commandText(command)
    if (!text) return yield* error("spawn", command, "Shell command did not include command text")

    const result = yield* Effect.promise(() =>
      new Bash({ fs: options.fs, cwd: workingDirectory }).exec(text, {
        env: Object.fromEntries(Object.entries(command.options.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      }),
    )
    return handle(result)
  })

  return makeSpawner(spawn)
}

export const layer = (options: Options): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(ChildProcessSpawner)(make(options))

export * as SimulationSpawner from "./spawner"

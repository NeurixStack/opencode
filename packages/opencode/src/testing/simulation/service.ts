import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import path from "path"
import { SimulationNetwork } from "./network"

export const FileContent = Schema.Union([
  Schema.String,
  Schema.Struct({ encoding: Schema.Literal("base64"), data: Schema.String }),
])

export const FilesystemSeedInput = Schema.Struct({
  files: Schema.Record(Schema.String, FileContent),
})

export const NetworkRegisterInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("json"),
    url: Schema.String,
    method: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Number),
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    body: Schema.Json,
  }),
  Schema.Struct({
    kind: Schema.Literal("text"),
    url: Schema.String,
    method: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Number),
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    body: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("status"),
    url: Schema.String,
    method: Schema.optional(Schema.String),
    status: Schema.Number,
    headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
])

type FilePath = string

interface State {
  readonly files: readonly FilePath[]
  readonly networkRegistrations: readonly string[]
}

export interface Interface {
  readonly reset: () => Effect.Effect<void>
  readonly seedFilesystem: (input: typeof FilesystemSeedInput.Type) => Effect.Effect<{ files: string[] }, unknown>
  readonly registerNetwork: (input: typeof NetworkRegisterInput.Type) => Effect.Effect<{ registered: string }, unknown>
  readonly snapshot: () => Effect.Effect<{
    files: readonly string[]
    networkRegistrations: readonly string[]
    network: SimulationNetwork.Snapshot
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Simulation") {}

function fileContent(content: typeof FileContent.Type) {
  if (typeof content === "string") return content
  return Uint8Array.from(Buffer.from(content.data, "base64"))
}

function matcher(input: typeof NetworkRegisterInput.Type) {
  return input.method ? { method: input.method, url: input.url } : input.url
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const network = yield* SimulationNetwork.Service
    const state = yield* Ref.make<State>({ files: [], networkRegistrations: [] })

    const reset = Effect.fn("Simulation.reset")(function* () {
      yield* network.reset()
      yield* Ref.set(state, { files: [], networkRegistrations: [] })
    })

    const seedFilesystem = Effect.fn("Simulation.seedFilesystem")(function* (input: typeof FilesystemSeedInput.Type) {
      const files = Object.keys(input.files)
      yield* Effect.forEach(
        Object.entries(input.files),
        ([file, content]) => fs.writeWithDirs(path.isAbsolute(file) ? file : path.join("/opencode", file), fileContent(content)),
      )
      yield* Ref.update(state, (current) => ({ ...current, files: [...current.files, ...files] }))
      return { files }
    })

    const registerNetwork = Effect.fn("Simulation.registerNetwork")(function* (input: typeof NetworkRegisterInput.Type) {
      switch (input.kind) {
        case "json":
          yield* network.register(
            SimulationNetwork.json(matcher(input), input.body, { status: input.status, headers: input.headers }),
          )
          break
        case "text":
          yield* network.register(
            SimulationNetwork.text(matcher(input), input.body, { status: input.status, headers: input.headers }),
          )
          break
        case "status":
          yield* network.register(SimulationNetwork.status(matcher(input), input.status, { headers: input.headers }))
          break
      }
      yield* Ref.update(state, (current) => ({
        ...current,
        networkRegistrations: [...current.networkRegistrations, `${input.method ?? "*"} ${input.url}`],
      }))
      return { registered: input.url }
    })

    const snapshot = Effect.fn("Simulation.snapshot")(function* () {
      const current = yield* Ref.get(state)
      return { ...current, network: yield* network.snapshot() }
    })

    return Service.of({ reset, seedFilesystem, registerNetwork, snapshot })
  }),
)

export * as Simulation from "./service"

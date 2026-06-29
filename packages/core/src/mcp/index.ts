export * as MCP from "./index"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { Integration } from "../integration"
import { IntegrationConnection } from "../integration/connection"

export const ServerName = Schema.String.pipe(Schema.brand("MCP.ServerName"))
export type ServerName = typeof ServerName.Type

const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "MCP.Status.Connected",
})
const StatusDisconnected = Schema.Struct({ status: Schema.Literal("disconnected") }).annotate({
  identifier: "MCP.Status.Disconnected",
})
const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "MCP.Status.Disabled",
})
const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "MCP.Status.Failed",
})
const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "MCP.Status.NeedsAuth",
})
const StatusNeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "MCP.Status.NeedsClientRegistration" })

export const Status = Schema.Union([
  StatusConnected,
  StatusDisconnected,
  StatusDisabled,
  StatusFailed,
  StatusNeedsAuth,
  StatusNeedsClientRegistration,
]).pipe(Schema.toTaggedUnion("status"))
export type Status = typeof Status.Type

export class ServerInfo extends Schema.Class<ServerInfo>("MCP.ServerInfo")({
  name: ServerName,
  config: ConfigMCP.Server,
  status: Status,
  integrationID: Integration.ID.pipe(Schema.optional),
  connection: IntegrationConnection.Info.pipe(Schema.optional),
}) {}

export class ServerInstructions extends Schema.Class<ServerInstructions>("MCP.ServerInstructions")({
  server: ServerName,
  instructions: Schema.String,
  tools: Schema.Array(Schema.String),
}) {}

export class PromptArgument extends Schema.Class<PromptArgument>("MCP.PromptArgument")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  required: Schema.Boolean.pipe(Schema.optional),
}) {}

export class Prompt extends Schema.Class<Prompt>("MCP.Prompt")({
  server: ServerName,
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  arguments: Schema.Array(PromptArgument).pipe(Schema.optional),
}) {}

export class PromptMessage extends Schema.Class<PromptMessage>("MCP.PromptMessage")({
  role: Schema.String,
  content: Schema.Unknown,
}) {}

export class PromptResult extends Schema.Class<PromptResult>("MCP.PromptResult")({
  server: ServerName,
  name: Schema.String,
  messages: Schema.Array(PromptMessage),
}) {}

export class Resource extends Schema.Class<Resource>("MCP.Resource")({
  server: ServerName,
  name: Schema.String,
  uri: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  mimeType: Schema.String.pipe(Schema.optional),
}) {}

export class ResourceTemplate extends Schema.Class<ResourceTemplate>("MCP.ResourceTemplate")({
  server: ServerName,
  name: Schema.String,
  uriTemplate: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  mimeType: Schema.String.pipe(Schema.optional),
}) {}

export class ResourceCatalog extends Schema.Class<ResourceCatalog>("MCP.ResourceCatalog")({
  resources: Schema.Array(Resource),
  templates: Schema.Array(ResourceTemplate),
}) {}

export const ResourceContentPart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    uri: Schema.String,
    text: Schema.String,
    mimeType: Schema.String.pipe(Schema.optional),
  }),
  Schema.Struct({
    type: Schema.Literal("blob"),
    uri: Schema.String,
    blob: Schema.String,
    mimeType: Schema.String.pipe(Schema.optional),
  }),
]).pipe(Schema.toTaggedUnion("type"))
export type ResourceContentPart = typeof ResourceContentPart.Type

export class ResourceContent extends Schema.Class<ResourceContent>("MCP.ResourceContent")({
  server: ServerName,
  uri: Schema.String,
  contents: Schema.Array(ResourceContentPart),
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  server: ServerName,
}) {}

type ServerEntry = {
  readonly config: typeof ConfigMCP.Server.Type
  readonly status: Status
  readonly integrationID?: Integration.ID
  readonly connection?: IntegrationConnection.Info
}

export interface Interface {
  readonly servers: () => Effect.Effect<ServerInfo[]>
  readonly add: (server: ServerName | string, config: typeof ConfigMCP.Server.Type) => Effect.Effect<ServerInfo>
  readonly connect: (server: ServerName | string) => Effect.Effect<ServerInfo, NotFoundError>
  readonly disconnect: (server: ServerName | string) => Effect.Effect<ServerInfo, NotFoundError>
  readonly instructions: () => Effect.Effect<ServerInstructions[]>
  readonly prompts: (input?: { readonly server?: ServerName | string }) => Effect.Effect<Prompt[], NotFoundError>
  readonly prompt: (input: {
    readonly server: ServerName | string
    readonly name: string
    readonly args?: Record<string, string>
  }) => Effect.Effect<PromptResult | undefined, NotFoundError>
  readonly resourceCatalog: (input?: {
    readonly server?: ServerName | string
  }) => Effect.Effect<ResourceCatalog, NotFoundError>
  readonly readResource: (input: {
    readonly server: ServerName | string
    readonly uri: string
  }) => Effect.Effect<ResourceContent | undefined, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const documents = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
    // Global MCP timeout defaults, later config files overriding earlier ones.
    const timeout = Object.assign(
      {},
      ...documents.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
    )
    // Later config files win for duplicate server names; per-server timeout overrides globals.
    const runtime = new Map<ServerName, ServerEntry>()
    for (const entry of documents) {
      for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) {
        runtime.set(ServerName.make(name), {
          config: { ...server, timeout: { ...timeout, ...server.timeout } },
          status: server.disabled ? { status: "disabled" } : { status: "disconnected" },
        })
      }
    }

    const requireServer = Effect.fnUntraced(function* (server: ServerName | string) {
      const name = ServerName.make(server)
      const entry = runtime.get(name)
      if (!entry) return yield* new NotFoundError({ server: name })
      return { name, entry }
    })

    const visibleStatus = (entry: ServerEntry): Status => (entry.config.disabled ? { status: "disabled" } : entry.status)

    const info = (name: ServerName, entry: ServerEntry) =>
      new ServerInfo({
        name,
        config: entry.config,
        status: visibleStatus(entry),
        integrationID: entry.integrationID,
        connection: entry.connection,
      })

    return Service.of({
      servers: Effect.fn("MCP.servers")(function* () {
        return Array.from(runtime, ([name, entry]) => info(name, entry)).toSorted((a, b) =>
          a.name.localeCompare(b.name),
        )
      }),
      add: Effect.fn("MCP.add")(function* (server, config) {
        const name = ServerName.make(server)
        const status: Status = config.disabled ? { status: "disabled" } : { status: "disconnected" }
        const entry = { config, status }
        runtime.set(name, entry)
        return info(name, entry)
      }),
      connect: Effect.fn("MCP.connect")(function* (server) {
        const current = yield* requireServer(server)
        return info(current.name, current.entry)
      }),
      disconnect: Effect.fn("MCP.disconnect")(function* (server) {
        const current = yield* requireServer(server)
        const status: Status = current.entry.config.disabled ? { status: "disabled" } : { status: "disconnected" }
        const entry = { ...current.entry, status }
        runtime.set(current.name, entry)
        return info(current.name, entry)
      }),
      instructions: Effect.fn("MCP.instructions")(function* () {
        return []
      }),
      prompts: Effect.fn("MCP.prompts")(function* (input) {
        if (input?.server !== undefined) yield* requireServer(input.server)
        return []
      }),
      prompt: Effect.fn("MCP.prompt")(function* (input) {
        yield* requireServer(input.server)
        return undefined
      }),
      resourceCatalog: Effect.fn("MCP.resourceCatalog")(function* (input) {
        if (input?.server !== undefined) yield* requireServer(input.server)
        return new ResourceCatalog({ resources: [], templates: [] })
      }),
      readResource: Effect.fn("MCP.readResource")(function* (input) {
        yield* requireServer(input.server)
        return undefined
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node] })

import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { EventLogger } from "@opencode-ai/core/event-logger"
import { Observability } from "@opencode-ai/core/observability"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { Project } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Job } from "@opencode-ai/core/job"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { OpenAPI, Tool } from "@opencode-ai/codemode"
import { HttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import { Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer } from "./location"
import { formLocationLayer } from "./middleware/form-location"
import { sessionLocationLayer } from "./middleware/session-location"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  EventLogger.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  Job.node,
  Project.node,
  SessionV2.node,
  PluginRuntime.providerNode,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
])

export function createRoutes(password?: string, codeModeClient?: Layer.Layer<HttpClient.HttpClient>) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "opencode", password: Option.some(password) })
      : ServerAuth.Config.layer,
    undefined,
    codeModeClient
      ? {
          opencode: openCodeTools(
            OpenAPI.fromSpec({
              spec: { ...OpenApi.fromApi(Api) },
              baseUrl: "http://opencode.local",
              headers: ServerAuth.headers({ username: "opencode", password }),
            }).tools,
            codeModeClient,
          ),
        }
      : undefined,
  )
}

export function createEmbeddedRoutes(sdkPlugins?: SdkPlugins.Store) {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "opencode", password: Option.none() }), sdkPlugins)
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  sdkPlugins?: SdkPlugins.Store,
  codeModeTools?: ToolRegistry.CodeModeTools,
) {
  const pluginRuntimeCell = PluginRuntime.makeCell()
  const codeMode = codeModeTools ? ToolRegistry.nodes(codeModeTools) : undefined
  const replacements: LayerNode.Replacements = [
    [SessionExecution.node, SessionExecutionLocal.node],
    [PluginRuntime.node, PluginRuntime.layerWithCell(pluginRuntimeCell)],
    [PluginRuntime.providerNode, PluginRuntime.providerNodeWithCell(pluginRuntimeCell)],
    ...(sdkPlugins ? [[SdkPlugins.node, SdkPlugins.layerWithStore(sdkPlugins)] as const] : []),
    ...(codeMode
      ? [[ToolRegistry.node, codeMode.node] as const, [ToolRegistry.toolsNode, codeMode.toolsNode] as const]
      : []),
  ]
  const serviceLayer = simulateEnabled()
    ? Layer.unwrap(
        Effect.gen(function* () {
          const { simulationReplacements, startDriveServer } = yield* Effect.promise(() =>
            import("@opencode-ai/simulation/backend"),
          )
          if (driveEnabled()) startDriveServer()
          return AppNodeBuilder.build(applicationServices, [
            ...replacements,
            ...(simulateEnabled() ? simulationReplacements : []),
          ])
        }),
      )
    : AppNodeBuilder.build(applicationServices, replacements)

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers.pipe(Layer.provide(serviceLayer))),
    Layer.provide(formLocationLayer),
    Layer.provide(sessionLocationLayer),
    Layer.provide(layer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
    Layer.provide(Observability.layer),
  )
}

function openCodeTools(tools: OpenAPI.Tools, client: Layer.Layer<HttpClient.HttpClient>): ToolRegistry.CodeModeTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => [
      name,
      Tool.isDefinition<HttpClient.HttpClient>(value)
        ? Tool.make({
            description: value.description,
            input: value.input,
            output: value.output,
            run: (input) => value.run(input).pipe(Effect.provide(client)),
          })
        : openCodeTools(value, client),
    ]),
  )
}

function simulateEnabled() {
  return !!process.env.OPENCODE_SIMULATE
}

function driveEnabled() {
  return !!process.env.OPENCODE_DRIVE
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)))

import { Config as EffectConfig, Context, Effect, Layer } from "effect"
import { NodePath } from "@effect/platform-node"
import { HttpApiBuilder, OpenApi } from "effect/unstable/httpapi"
import {
  FetchHttpClient,
  HttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Account } from "@/account/account"
import { AccountRepo } from "@/account/repo"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Command } from "@/command"
import * as Observability from "@opencode-ai/core/effect/observability"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Permission } from "@/permission"
import { Installation } from "@/installation"
import { InstanceLayer } from "@/project/instance-layer"
import { Npm } from "@opencode-ai/core/npm"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Project } from "@/project/project"
import { ProviderAuth } from "@/provider/auth"
import { ModelsDev } from "@opencode-ai/core/models"
import { Provider } from "@/provider/provider"
import { Pty } from "@/pty"
import { PtyTicket } from "@/pty/ticket"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionProcessor } from "@/session/processor"
import { Instruction } from "@/session/instruction"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LLM } from "@/session/llm"
import { SystemPrompt } from "@/session/system"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { lazy } from "@/util/lazy"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { Workspace } from "@/control-plane/workspace"
import { SimulationFileSystem } from "@/testing/simulation/filesystem"
import { SimulationNetwork } from "@/testing/simulation/network"
import { SimulationNetworkRoutes } from "@/testing/simulation/network-routes"
import { SimulationProvider } from "@/testing/simulation/provider"
import { SimulationSpawner } from "@/testing/simulation/spawner"
import { Simulation } from "@/testing/simulation/service"
import { CorsConfig, isAllowedCorsOrigin, type CorsOptions } from "@/server/cors"
import { serveUIEffect } from "@/server/shared/ui"
import { ServerAuth } from "@/server/auth"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { InMemoryFs } from "just-bash"
import { PublicApi } from "./public"
import { authorizationLayer, authorizationRouterMiddleware } from "./middleware/authorization"
import { EventApi } from "./groups/event"
import { eventHandlers } from "./handlers/event"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { experimentalHandlers } from "./handlers/experimental"
import { fileHandlers } from "./handlers/file"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { mcpHandlers } from "./handlers/mcp"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectRoute, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { sessionHandlers } from "./handlers/session"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { v2Handlers } from "./handlers/v2"
import { workspaceHandlers } from "./handlers/workspace"
import { instanceContextLayer, instanceRouterMiddleware } from "./middleware/instance-context"
import { workspaceRouterMiddleware, workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { simulationRoute } from "./simulation"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { compressionLayer } from "./middleware/compression"
import { corsVaryFix } from "./middleware/cors-vary"
import { errorLayer } from "./middleware/error"
import { fenceLayer } from "./middleware/fence"
import { schemaErrorLayer } from "./middleware/schema-error"

export const context = Context.makeUnsafe<unknown>(new Map())

const cors = (corsOptions?: CorsOptions) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => isAllowedCorsOrigin(origin, corsOptions),
      maxAge: 86_400,
    }),
    { global: true },
  )

// Route tree:
// - rootApiRoutes: typed /global/* and control routes; auth is declared by RootHttpApi.
// - eventApiRoutes/rawInstanceRoutes: raw instance routes; auth and workspace routing happen as router middleware.
// - instanceApiRoutes: schema routes; auth is declared on each group and workspace context is provided below.
// - uiRoute: raw catch-all fallback; auth is router middleware so public static assets can bypass it.
const authOnlyRouterLayer = authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const httpApiAuthLayer = authorizationLayer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))
const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(
  Layer.provide([controlHandlers, globalHandlers]),
  Layer.provide(schemaErrorLayer),
  Layer.provide(httpApiAuthLayer),
)
const instanceRouterLayer = authorizationRouterMiddleware
  .combine(instanceRouterMiddleware)
  .combine(workspaceRouterMiddleware)
  .layer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal), Layer.provide(ServerAuth.Config.defaultLayer))
const eventApiRoutes = HttpApiBuilder.layer(EventApi).pipe(
  Layer.provide(eventHandlers),
  Layer.provide(instanceRouterLayer),
)
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers,
    instanceHandlers,
    mcpHandlers,
    projectHandlers,
    ptyHandlers,
    questionHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    syncHandlers,
    v2Handlers,
    tuiHandlers,
    workspaceHandlers,
  ]),
)

const rawInstanceRoutes = Layer.mergeAll(ptyConnectRoute).pipe(Layer.provide(instanceRouterLayer))
const instanceRoutes = Layer.mergeAll(rawInstanceRoutes, instanceApiRoutes).pipe(
  Layer.provide([
    httpApiAuthLayer,
    workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    instanceContextLayer,
    schemaErrorLayer,
  ]),
)

// `OpenApi.fromApi` is non-trivial; defer until /doc is actually hit so
// processes that never serve it (CLI, scripts) don't pay at module load.
// `HttpServerResponse.jsonUnsafe` runs JSON.stringify eagerly, so caching
// the response also caches the serialized body — every /doc request reuses
// the same Uint8Array instead of re-stringifying the spec.
const docResponse = lazy(() => HttpServerResponse.jsonUnsafe(OpenApi.fromApi(PublicApi)))

const docRoute = HttpRouter.use((router) => router.add("GET", "/doc", () => Effect.succeed(docResponse()))).pipe(
  Layer.provide(authOnlyRouterLayer),
)

const uiRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const client = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    yield* router.add("*", "/*", (request) =>
      serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
    )
  }),
).pipe(Layer.provide(authOnlyRouterLayer))

const simulationShareNextLayer = Layer.succeed(
  ShareNext.Service,
  ShareNext.Service.of({
    init: () => Effect.void,
    url: () => Effect.succeed("https://opncd.ai"),
    request: () =>
      Effect.succeed({
        headers: {},
        baseUrl: "https://opncd.ai",
        api: {
          create: "/api/shares",
          sync: (shareID) => `/api/shares/${shareID}/sync`,
          remove: (shareID) => `/api/shares/${shareID}`,
          data: (shareID) => `/api/shares/${shareID}/data`,
        },
      }),
    create: () => Effect.succeed({ id: "", url: "", secret: "" }),
    remove: () => Effect.void,
  }),
)

type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>

function createProductionRoutes(
  corsOptions?: CorsOptions,
): Layer.Layer<never, EffectConfig.ConfigError, RouteRequirements> {
  return Layer.mergeAll(rootApiRoutes, eventApiRoutes, instanceRoutes, docRoute, uiRoute).pipe(
    Layer.provide([
      errorLayer,
      compressionLayer,
      corsVaryFix,
      fenceLayer,
      cors(corsOptions),
      Account.defaultLayer,
      Agent.defaultLayer,
      Auth.defaultLayer,
      Command.defaultLayer,
      Config.defaultLayer,
      File.defaultLayer,
      FileWatcher.defaultLayer,
      Format.defaultLayer,
      LSP.defaultLayer,
      Installation.defaultLayer,
      MCP.defaultLayer,
      ModelsDev.defaultLayer,
      Permission.defaultLayer,
      Plugin.defaultLayer,
      Project.defaultLayer,
      ProviderAuth.defaultLayer,
      Provider.defaultLayer,
      Pty.defaultLayer,
      PtyTicket.defaultLayer,
      Question.defaultLayer,
      Ripgrep.defaultLayer,
      RuntimeFlags.defaultLayer,
      Session.defaultLayer,
      SessionCompaction.defaultLayer,
      SessionPrompt.defaultLayer,
      SessionRevert.defaultLayer,
      SessionShare.defaultLayer,
      SessionRunState.defaultLayer,
      SessionStatus.defaultLayer,
      SessionSummary.defaultLayer,
      ShareNext.defaultLayer,
      Snapshot.defaultLayer,
      SyncEvent.defaultLayer,
      EventV2Bridge.defaultLayer,
      Skill.defaultLayer,
      Todo.defaultLayer,
      ToolRegistry.defaultLayer,
      Vcs.defaultLayer,
      Workspace.defaultLayer,
      Worktree.appLayer,
      Bus.layer,
      AppFileSystem.defaultLayer,
      FetchHttpClient.layer,
      HttpServer.layerServices,
    ]),
    Layer.provide(Layer.succeed(CorsConfig)(corsOptions)),
    Layer.provide(InstanceLayer.layer),
    Layer.provide(Observability.layer),
  )
}

export function createSimulatedRoutes(corsOptions?: CorsOptions): ReturnType<typeof createProductionRoutes> {
  const fs = new InMemoryFs()
  const simulationBoundary = Layer.mergeAll(
    SimulationFileSystem.layer({ root: "/opencode", fs }),
    SimulationSpawner.layer({ root: "/opencode", fs }),
    SimulationNetwork.layer({ entries: SimulationNetworkRoutes.defaults(), allowLoopback: true }),
  )

  const simulatedRoutes = Layer.mergeAll(
    rootApiRoutes,
    eventApiRoutes,
    instanceRoutes,
    docRoute,
    uiRoute,
    simulationRoute,
  )

  const withRouteAndLeafServices = simulatedRoutes.pipe(
    Layer.provideMerge(errorLayer),
    Layer.provideMerge(compressionLayer),
    Layer.provideMerge(corsVaryFix),
    Layer.provideMerge(fenceLayer),
    Layer.provideMerge(cors(corsOptions)),
    Layer.provideMerge(runtime),
    Layer.provideMerge(File.layer),
    Layer.provideMerge(FileWatcher.layer),
    Layer.provideMerge(Installation.layer),
    Layer.provideMerge(ModelsDev.layer),
  )

  const withEndpointServices = withRouteAndLeafServices.pipe(
    Layer.provideMerge(ProviderAuth.layer),
    Layer.provideMerge(Pty.layer),
    Layer.provideMerge(PtyTicket.layer),
    Layer.provideMerge(SessionShare.layer),
    Layer.provideMerge(simulationShareNextLayer),
    Layer.provideMerge(Workspace.layer),
    Layer.provideMerge(Worktree.layer),
    Layer.provideMerge(HttpServer.layerServices),
  )

  const withSessionAndToolConsumers = withEndpointServices.pipe(
    Layer.provideMerge(Project.layer),
    Layer.provideMerge(SessionPrompt.layer),
    Layer.provideMerge(SessionRevert.layer),
    Layer.provideMerge(ToolRegistry.layer),
    Layer.provideMerge(SessionCompaction.layer),
    Layer.provideMerge(SessionProcessor.layer),
    Layer.provideMerge(SessionSummary.layer),
    Layer.provideMerge(Agent.layer),
    Layer.provideMerge(Command.layer),
  )

  const withToolDependencies = withSessionAndToolConsumers.pipe(
    Layer.provideMerge(Vcs.layer),
    Layer.provideMerge(Ripgrep.layer),
    Layer.provideMerge(Format.layer),
    Layer.provideMerge(Todo.layer),
    Layer.provideMerge(Question.layer),
    Layer.provideMerge(Truncate.layer),
    Layer.provideMerge(Instruction.layer),
    Layer.provideMerge(Snapshot.layer),
    Layer.provideMerge(LSP.layer),
    Layer.provideMerge(MCP.layer),
    Layer.provideMerge(SyncEvent.layer),
  )

  const withSessionProviderDependencies = withToolDependencies.pipe(
    Layer.provideMerge(McpAuth.layer),
    Layer.provideMerge(SessionRunState.layer),
    Layer.provideMerge(SessionStatus.layer),
    Layer.provideMerge(Session.layer),
    Layer.provideMerge(Storage.layer),
    Layer.provideMerge(LLM.layer),
    Layer.provideMerge(SystemPrompt.layer),
    Layer.provideMerge(Skill.layer),
    Layer.provideMerge(Discovery.layer),
  )

  const withCoreAppServices = withSessionProviderDependencies.pipe(
    Layer.provideMerge(Plugin.layer),
    Layer.provideMerge(Permission.layer),
    Layer.provideMerge(SimulationProvider.layer),
    Layer.provideMerge(Simulation.layer),
    Layer.provideMerge(Config.layer),
    Layer.provideMerge(Account.layer),
    Layer.provideMerge(Auth.layer),
    Layer.provideMerge(AccountRepo.layer),
  )

  return withCoreAppServices.pipe(
    Layer.provideMerge(Git.layer),
    Layer.provideMerge(Npm.layer),
    Layer.provideMerge(Env.layer),
    Layer.provideMerge(Bus.layer),
    Layer.provideMerge(Global.layer),
    Layer.provideMerge(NodePath.layer),
    Layer.provideMerge(simulationBoundary),
    Layer.provideMerge(Layer.succeed(CorsConfig)(corsOptions)),
    Layer.provideMerge(InstanceLayer.layer),
    Layer.provideMerge(Observability.layer),
  ) as ReturnType<typeof createProductionRoutes>
}

export function createRoutes(corsOptions?: CorsOptions) {
  if (Flag.OPENCODE_SIMULATION_BACKEND) {
    return createSimulatedRoutes(corsOptions)
  }

  return createProductionRoutes(corsOptions)
}

export const routes = createRoutes()

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    disableLogger: true,
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as HttpApiApp from "./server"

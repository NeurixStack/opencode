import { OpenCode } from "@opencode-ai/client/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { ConfigProvider, Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"

export interface Options {
  /**
   * Replaces the ConfigProvider read while this host's process-global layers
   * are built, for example the OPENCODE_DB database placement. The default
   * provider snapshots the process environment on first use, so per-host
   * configuration must come through this seam rather than env mutation.
   * Location-scoped layers build lazily outside host construction and still
   * read the process default. Compose with
   * ConfigProvider.orElse(ConfigProvider.fromEnv()) to keep environment
   * fallback.
   */
  readonly configProvider?: ConfigProvider.ConfigProvider
}

export const create = Effect.fn("OpenCode.create")(function* (options?: Options) {
  const scope = yield* Scope.Scope
  const memoMap = yield* Layer.makeMemoMap
  const configLayer = options?.configProvider === undefined ? undefined : ConfigProvider.layer(options.configProvider)
  const withConfig = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
    configLayer === undefined ? layer : layer.pipe(Layer.provide(configLayer))
  const sdkPlugins = SdkPlugins.makeStore()
  const context = yield* Layer.buildWithMemoMap(
    withConfig(
      AppNodeBuilder.build(LayerNode.group([PermissionSaved.node, SdkPlugins.node]), [
        [SdkPlugins.node, SdkPlugins.layerWithStore(sdkPlugins)],
      ]),
    ),
    memoMap,
    scope,
  )
  const plugins = Context.get(context, SdkPlugins.Service)
  const permissions = Context.get(context, PermissionSaved.Service)
  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        withConfig(
          createEmbeddedRoutes(sdkPlugins).pipe(
            HttpRouter.provideRequest(Layer.succeed(PermissionSaved.Service, permissions)),
            Layer.provide(HttpServer.layerServices),
          ),
        ),
        { disableLogger: true, memoMap },
      ),
    ),
    (web) => Effect.promise(web.dispose),
  )
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  )
  return {
    ...client,
    sessions: client.session,
    events: client.event,
    // The embedded host contributes plugins through the ordinary discovery flow:
    // each plugin's `effect` runs inside every Location with the real
    // `PluginContext`, so `ctx.agent.transform` and every other hook behave exactly
    // as they do for a config-discovered plugin. Define agent profiles here at
    // startup, then select one per Session with `sessions.create({ agent })`.
    plugin: Object.assign(plugins.register, client.plugin),
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk-next/OpenCode") {}

export const layerWith = (options: Options) => Layer.effect(Service, create(options))

export const layer = layerWith({})

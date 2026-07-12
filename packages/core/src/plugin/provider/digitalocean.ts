import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import { Credential } from "../../credential"
import { EventV2 } from "../../event"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

const clientID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const authorizeURL = "https://cloud.digitalocean.com/v1/oauth/authorize"
const genaiURL = "https://api.digitalocean.com/v2/gen-ai"
const inferenceURL = "https://inference.do-ai.run/v1"
const callbackPort = 1456
const callbackPath = "/auth/callback"
const tokenPath = "/auth/token"
const scopes = "genai:read inference:query"
const refreshInterval = 5 * 60 * 1000
const integrationID = Integration.ID.make("digitalocean")
const methodID = Integration.MethodID.make("implicit")

const Token = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.NumberFromString,
  state: Schema.String,
})
const Router = Schema.Struct({
  name: Schema.String,
  uuid: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})
type Router = typeof Router.Type
const RouterResponse = Schema.Struct({ model_routers: Schema.optional(Schema.Array(Router)) })

const oauth = {
  integrationID,
  method: {
    id: methodID,
    type: "oauth",
    label: "Login with DigitalOcean",
  },
  authorize: () =>
    Effect.gen(function* () {
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
      const token = yield* Deferred.make<typeof Token.Type, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://localhost:${callbackPort}`)
        if (request.method === "GET" && url.pathname === callbackPath) {
          response
            .writeHead(200, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.bootstrap({ tokenPath, provider: "DigitalOcean" }))
          return
        }
        if (request.method !== "POST" || url.pathname !== tokenPath) {
          response.writeHead(404).end("Not found")
          return
        }
        const chunks: Buffer[] = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        request.on("end", () => {
          const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Token))(Buffer.concat(chunks).toString())
          if (Option.isNone(decoded) || decoded.value.state !== state) {
            const error = Option.isNone(decoded) ? "Invalid OAuth callback" : "Invalid OAuth state"
            Effect.runFork(Deferred.fail(token, new Error(error)))
            response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error }))
            return
          }
          Effect.runFork(Deferred.succeed(token, decoded.value))
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
        })
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(callbackPort, "localhost", () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      const redirect = `http://localhost:${callbackPort}${callbackPath}`
      return {
        mode: "auto" as const,
        url: `${authorizeURL}?${new URLSearchParams({
          response_type: "token",
          client_id: clientID,
          redirect_uri: redirect,
          scope: scopes,
          state,
        })}`,
        instructions:
          "Sign in to DigitalOcean in your browser. OpenCode will use the resulting token for inference and load your Inference Routers.",
        callback: Deferred.await(token).pipe(
          Effect.flatMap((value) =>
            listRouters(value.access_token).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("failed to sync DigitalOcean inference routers", { cause }).pipe(Effect.as([])),
              ),
              Effect.map((routers) =>
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  refresh: value.access_token,
                  access: value.access_token,
                  expires: Date.now() + value.expires_in * 1000,
                  metadata: { routers, routersFetchedAt: Date.now() },
                }),
              ),
            ),
          ),
        ),
      }
    }),
} satisfies IntegrationOAuthMethodRegistration

export const DigitalOceanPlugin = define({
  id: "opencode.provider.digitalocean",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: { routers: readonly Router[] } = { routers: [] }

    const load = Effect.fn("DigitalOceanPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const saved = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      if (saved?.type !== "oauth") {
        loaded.routers = []
        return
      }
      const cached = Schema.decodeUnknownOption(Schema.Array(Router))(saved.metadata?.routers)
      loaded.routers = cached._tag === "Some" ? cached.value : []
      const fetchedAt = saved.metadata?.routersFetchedAt
      if (typeof fetchedAt === "number" && Date.now() - fetchedAt <= refreshInterval) return
      if (saved.expires <= Date.now()) return
      const routers = yield* listRouters(saved.access).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to refresh DigitalOcean inference routers", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (!routers) return
      loaded.routers = routers
    })

    yield* ctx.integration.transform((draft) => {
      draft.update(integrationID, (integration) => {
        integration.name = "DigitalOcean"
      })
      draft.method.update(oauth)
      draft.method.update({
        integrationID,
        method: { type: "key", label: "Paste Model Access Key" },
      })
    })
    yield* ctx.catalog.transform((catalog) => {
      if (!catalog.provider.get(ProviderV2.ID.make(integrationID))) return
      for (const router of loaded.routers) {
        const id = ModelV2.ID.make(`router:${router.name}`)
        catalog.model.update(ProviderV2.ID.make(integrationID), id, (model) => {
          model.modelID = id
          model.name = router.name
          model.family = ModelV2.Family.make("digitalocean-inference-routers")
          model.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
          model.settings = ProviderV2.mergeOverlay(model.settings, { baseURL: inferenceURL })
          model.capabilities = { tools: true, input: ["text"], output: ["text"] }
          model.limit = { context: 128_000, output: 8_192 }
        })
      }
    })

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
  }),
} satisfies PluginInternal.InternalPlugin)

function listRouters(access: string) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${genaiURL}/models/routers`, {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: "application/json",
          "User-Agent": `opencode/${InstallationVersion}`,
        },
        signal,
      })
      if (!response.ok) throw new Error(`DigitalOcean router request failed: ${response.status}`)
      const body = Schema.decodeUnknownSync(RouterResponse)(await response.json())
      return body.model_routers ?? []
    },
    catch: (cause) => cause,
  })
}

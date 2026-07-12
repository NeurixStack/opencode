import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect, Schema } from "effect"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"

const clientID = "client_728290227fc048cc9262091a1ea197ea"
const authorizationEndpoint = "https://poe.com/oauth/authorize"
const tokenEndpoint = "https://api.poe.com/token"
const callbackPath = "/callback"
const integrationID = Integration.ID.make("poe")
const methodID = Integration.MethodID.make("browser")

const Token = Schema.Struct({
  api_key: Schema.String,
  api_key_expires_in: Schema.optional(Schema.NullOr(Schema.Number)),
})

const oauth = {
  integrationID,
  method: {
    id: methodID,
    type: "oauth",
    label: "Login with Poe (browser)",
  },
  authorize: () =>
    Effect.gen(function* () {
      const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const challenge = Buffer.from(
        yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
      ).toString("base64url")
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        if (url.pathname !== callbackPath) {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error")
        if (error) {
          const description = url.searchParams.get("error_description") ?? error
          Effect.runFork(Deferred.fail(code, new Error(`OAuth authorization failed: ${error} - ${description}`)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(description, { provider: "Poe" }))
          return
        }
        const value = url.searchParams.get("code")
        if (!value) {
          Effect.runFork(Deferred.fail(code, new Error("OAuth callback missing authorization code")))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error("Missing authorization code", { provider: "Poe" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: "Poe" }))
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(0, "127.0.0.1", () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.closeAllConnections()
          server.close()
        }),
      )
      const address = server.address() as AddressInfo
      const redirectURI = `http://127.0.0.1:${address.port}${callbackPath}`
      return {
        mode: "auto" as const,
        url: `${authorizationEndpoint}?${new URLSearchParams({
          response_type: "code",
          client_id: clientID,
          scope: "apikey:create",
          code_challenge: challenge,
          code_challenge_method: "S256",
          redirect_uri: redirectURI,
        })}`,
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            Effect.tryPromise({
              try: (signal) =>
                fetch(tokenEndpoint, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: value,
                    code_verifier: verifier,
                    client_id: clientID,
                    redirect_uri: redirectURI,
                  }).toString(),
                  signal,
                }),
              catch: (cause) => cause,
            }),
          ),
          Effect.flatMap((response) => {
            if (response.ok)
              return Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(Token)))
            return Effect.promise(() => response.text()).pipe(
              Effect.flatMap((detail) =>
                Effect.fail(new Error(`Poe token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)),
              ),
            )
          }),
          Effect.map((token) =>
            Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: token.api_key,
              refresh: token.api_key,
              expires:
                token.api_key_expires_in == null
                  ? Number.MAX_SAFE_INTEGER
                  : Date.now() + token.api_key_expires_in * 1000,
            }),
          ),
        ),
      }
    }),
} satisfies IntegrationOAuthMethodRegistration

export const PoePlugin = define({
  id: "opencode.provider.poe",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update(integrationID, (integration) => {
        integration.name = "Poe"
      })
      draft.method.update(oauth)
      draft.method.update({ integrationID, method: { type: "key", label: "Manually enter API Key" } })
    })
  }),
})

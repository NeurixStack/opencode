import { createServer } from "node:http"
import os from "os"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { InstallationVersion } from "../../installation/version"
import { Deferred, Effect, Schema } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"

const defaultInstanceUrl = "https://gitlab.com"
const bundledClientID = "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const callbackHost = "127.0.0.1"
const callbackPort = 8080
const callbackPath = "/callback"
const redirectURI = `http://${callbackHost}:${callbackPort}${callbackPath}`
const methodID = Integration.MethodID.make("oauth")

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
type Token = typeof Token.Type

const oauth = {
  integrationID: Integration.ID.make("gitlab"),
  method: {
    id: methodID,
    type: "oauth",
    label: "GitLab OAuth",
    prompts: [
      {
        type: "text",
        key: "instanceUrl",
        message: "GitLab instance URL",
        placeholder: defaultInstanceUrl,
      },
    ],
  },
  authorize: (inputs) =>
    Effect.gen(function* () {
      const instanceUrl = normalizeInstanceUrl(inputs.instanceUrl)
      const pkce = yield* Effect.promise(generatePKCE)
      const state = randomString(32)
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirectURI)
        if (url.pathname !== callbackPath) {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        if (error) {
          Effect.runFork(Deferred.fail(code, new Error(error)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(error, { provider: "GitLab" }))
          return
        }
        if (!value || url.searchParams.get("state") !== state) {
          const message = value ? "Invalid OAuth state" : "Missing authorization code"
          Effect.runFork(Deferred.fail(code, new Error(message)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(message, { provider: "GitLab" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: "GitLab" }))
      })
      yield* Effect.callback<void, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(callbackPort, callbackHost, () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      return {
        mode: "auto" as const,
        url: `${instanceUrl}/oauth/authorize?${new URLSearchParams({
          client_id: clientID(),
          redirect_uri: redirectURI,
          response_type: "code",
          state,
          scope: "api",
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
        })}`,
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            token(instanceUrl, {
              grant_type: "authorization_code",
              code: value,
              redirect_uri: redirectURI,
              client_id: clientID(),
              code_verifier: pkce.verifier,
            }),
          ),
          Effect.flatMap((value) => credential(value, instanceUrl)),
        ),
      }
    }),
  refresh: (value) => {
    const instanceUrl = normalizeMetadataInstanceUrl(value.metadata?.instanceUrl)
    return token(instanceUrl, {
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID(),
    }).pipe(Effect.flatMap((next) => credential(next, instanceUrl, next.refresh_token ?? value.refresh)))
  },
  label: (value) => (typeof value.metadata?.instanceUrl === "string" ? value.metadata.instanceUrl : undefined),
} satisfies IntegrationOAuthMethodRegistration

export const GitLabPlugin = define({
  id: "opencode.provider.gitlab",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.method.update(oauth)
      draft.method.update({
        integrationID: Integration.ID.make("gitlab"),
        method: {
          type: "key",
          label: "GitLab Personal Access Token",
          prompts: [
            {
              type: "text",
              key: "instanceUrl",
              message: "GitLab instance URL",
              placeholder: defaultInstanceUrl,
            },
          ],
        },
        authorize: (key, inputs) =>
          Effect.gen(function* () {
            const instanceUrl = normalizeInstanceUrl(inputs.instanceUrl)
            const response = yield* send(`${instanceUrl}/api/v4/user`, {
              headers: { Authorization: `Bearer ${key}` },
            })
            if (!response.ok)
              return yield* Effect.fail(new Error(`GitLab token validation failed (${response.status})`))
            return Credential.Key.make({ type: "key", key, metadata: { instanceUrl } })
          }),
      })
      draft.method.update({
        integrationID: Integration.ID.make("gitlab"),
        method: { type: "env", names: ["GITLAB_TOKEN"] },
      })
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "gitlab-ai-provider") return
        const mod = yield* Effect.promise(() => import("gitlab-ai-provider"))
        evt.sdk = mod.createGitLab({
          ...evt.options,
          instanceUrl:
            typeof evt.options.instanceUrl === "string"
              ? evt.options.instanceUrl
              : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"),
          apiKey: typeof evt.options.apiKey === "string" ? evt.options.apiKey : process.env.GITLAB_TOKEN,
          aiGatewayHeaders: {
            "User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            "anthropic-beta": "context-1m-2025-08-07",
            ...evt.options.aiGatewayHeaders,
          },
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...evt.options.featureFlags,
          },
        })
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        const id = evt.model.modelID ?? evt.model.id
        if (id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider")).pipe(Effect.orDie)
          const workflowRef =
            typeof evt.model.settings?.workflowRef === "string" ? evt.model.settings.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.settings?.workflowDefinition === "string"
              ? evt.model.settings.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(gitlab.isWorkflowModel(id) ? id : "duo-workflow", {
            featureFlags,
            workflowDefinition,
          })
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(id, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    )
  }),
})

function clientID() {
  return process.env.GITLAB_OAUTH_CLIENT_ID ?? bundledClientID
}

function normalizeInstanceUrl(value?: string) {
  const input = value?.trim() || process.env.GITLAB_INSTANCE_URL || defaultInstanceUrl
  return normalizeURL(input)
}

function normalizeMetadataInstanceUrl(value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("GitLab OAuth credential is missing instanceUrl metadata")
  return normalizeURL(value)
}

function normalizeURL(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GitLab instance URL must use http or https")
  }
  return `${url.protocol}//${url.host}`
}

function token(instanceUrl: string, body: Record<string, string>) {
  return send(`${instanceUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  }).pipe(
    Effect.flatMap((response) => {
      if (response.ok) {
        return Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(Token)))
      }
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((detail) =>
          Effect.fail(new Error(`GitLab token request failed (${response.status})${detail ? `: ${detail}` : ""}`)),
        ),
      )
    }),
  )
}

function send(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
    catch: (cause) => cause,
  })
}

function credential(tokens: Token, instanceUrl: string, currentRefresh?: string) {
  const refresh = tokens.refresh_token ?? currentRefresh
  if (!refresh) return Effect.fail(new Error("GitLab token response is missing refresh_token"))
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: tokens.access_token,
      refresh,
      expires: Date.now() + (tokens.expires_in ?? 7200) * 1000,
      metadata: { instanceUrl },
    }),
  )
}

async function generatePKCE() {
  const verifier = randomString(64)
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString(
    "base64url",
  )
  return { verifier, challenge }
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => chars[byte % chars.length]).join("")
}

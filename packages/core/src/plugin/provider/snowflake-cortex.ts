import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect, Schema } from "effect"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

const integrationID = Integration.ID.make("snowflake-cortex")
const browserMethodID = Integration.MethodID.make("snowflake-browser")
const clientID = "LOCAL_APPLICATION"
const callbackHost = "127.0.0.1"

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})

export function oauthScope(role: string | undefined) {
  if (!role) return "refresh_token"
  return /^[-_A-Za-z0-9]+$/.test(role)
    ? `refresh_token session:role:${role}`
    : `refresh_token session:role-encoded:${encodeURIComponent(role)}`
}

// Exported for testing: intercepts Cortex-specific request/response quirks.
export function cortexFetch(upstream: FetchLike = fetch) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(url instanceof Request ? url.headers : undefined)
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    headers.set("User-Agent", `opencode/${InstallationVersion}`)
    init = { ...init, headers }
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if ("max_tokens" in body) {
          body.max_completion_tokens = body.max_tokens
          delete body.max_tokens
          init = { ...init, body: JSON.stringify(body) }
        }
      } catch {}
    }

    const response = await upstream(url, init)

    // Cortex returns 400 "conversation complete" as a normal stop condition
    if (!response.ok && response.status === 400) {
      try {
        const errorData = (await response.clone().json()) as Record<string, unknown>
        if (
          String(errorData.message || errorData.error || "")
            .toLowerCase()
            .includes("conversation complete")
        ) {
          return new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "", role: "assistant" } }] }),
            { status: 200, headers: new Headers({ "content-type": "application/json" }) },
          )
        }
      } catch {}
    }

    // Cortex returns role:"" in streaming deltas; the AI SDK schema requires "assistant"
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const stream = new ReadableStream({
        async pull(ctrl) {
          const { done, value } = await reader.read()
          if (done) {
            ctrl.close()
            return
          }
          ctrl.enqueue(
            encoder.encode(decoder.decode(value, { stream: true }).replace(/"role"\s*:\s*""/g, '"role":"assistant"')),
          )
        },
        cancel() {
          reader.cancel()
        },
      })
      return new Response(stream, { headers: response.headers, status: response.status })
    }

    return response
  }
}

export const SnowflakeCortexPlugin = define({
  id: "opencode.provider.snowflake-cortex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.method.update(browser)
      draft.method.update({
        integrationID: "snowflake-cortex",
        method: { type: "key", label: "Paste PAT or bearer token manually" },
      })
      draft.method.update({
        integrationID: "snowflake-cortex",
        method: { type: "env", names: ["SNOWFLAKE_CORTEX_TOKEN", "SNOWFLAKE_CORTEX_PAT"] },
      })
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("snowflake-cortex")) return
        const account = normalizeAccount(
          process.env.SNOWFLAKE_ACCOUNT ?? (typeof evt.options.account === "string" ? evt.options.account : ""),
        )
        const token =
          process.env.SNOWFLAKE_CORTEX_TOKEN ??
          process.env.SNOWFLAKE_CORTEX_PAT ??
          (typeof evt.options.token === "string" ? evt.options.token : undefined) ??
          (typeof evt.options.apiKey === "string" ? evt.options.apiKey : undefined)
        const upstream = typeof evt.options.fetch === "function" ? (evt.options.fetch as FetchLike) : undefined
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        if (account) evt.options.baseURL = `https://${account}.snowflakecomputing.com/api/v2/cortex/v1`
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible({
          ...evt.options,
          ...(token ? { apiKey: token } : {}),
          fetch: cortexFetch(upstream) as typeof fetch,
        } as any)
      }),
    )
  }),
})

const accountPrompt = {
  type: "text" as const,
  key: "account",
  message: "Snowflake Account Identifier",
  placeholder: "myorg-myaccount",
}

const browser = {
  integrationID,
  method: {
    id: browserMethodID,
    type: "oauth",
    label: "Login with Snowflake (External Browser)",
    prompts: [
      accountPrompt,
      {
        type: "text",
        key: "role",
        message: "Snowflake Role (optional)",
        placeholder: "PUBLIC",
      },
    ],
  },
  authorize: (inputs) =>
    Effect.gen(function* () {
      const account = normalizeAccount(inputs.account ?? "")
      if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))

      const pkce = yield* Effect.promise(generatePKCE)
      const state = randomString(64)
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://${callbackHost}`)
        if (url.pathname !== "/") {
          response.writeHead(404).end("Not found")
          return
        }
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
        const value = url.searchParams.get("code")
        if (error) {
          Effect.runFork(Deferred.fail(code, new Error(error)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(error, { provider: "Snowflake" }))
          return
        }
        if (!value || url.searchParams.get("state") !== state) {
          const message = value ? "Invalid state - potential CSRF attack" : "Missing authorization code"
          Effect.runFork(Deferred.fail(code, new Error(message)))
          response
            .writeHead(400, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.error(message, { provider: "Snowflake" }))
          return
        }
        Effect.runFork(Deferred.succeed(code, value))
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.success({ provider: "Snowflake" }))
      })
      const port = yield* Effect.callback<number, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(0, callbackHost, () => {
          const address = server.address()
          if (!address || typeof address === "string") {
            resume(Effect.fail(new Error("Unable to resolve Snowflake OAuth callback port")))
            return
          }
          resume(Effect.succeed(address.port))
        })
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      const redirect = `http://${callbackHost}:${port}/`
      const role = inputs.role?.trim() || undefined
      const url = `https://${account}.snowflakecomputing.com/oauth/authorize?${new URLSearchParams({
        client_id: clientID,
        response_type: "code",
        redirect_uri: redirect,
        scope: oauthScope(role),
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })}`
      return {
        mode: "auto" as const,
        url,
        instructions:
          "Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback and store the bearer token automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) =>
            token(account, {
              grant_type: "authorization_code",
              code: value,
              redirect_uri: redirect,
              client_id: clientID,
              code_verifier: pkce.verifier,
            }),
          ),
          Effect.flatMap((value) =>
            value.refresh_token
              ? Effect.succeed(credential(value, account, value.refresh_token))
              : Effect.fail(
                  new Error(
                    "Snowflake token response did not include refresh_token. Ensure integration issues refresh tokens and scope includes refresh_token.",
                  ),
                ),
          ),
        ),
      }
    }),
  refresh: (value) => {
    const account = typeof value.metadata?.account === "string" ? normalizeAccount(value.metadata.account) : ""
    if (!account) return Effect.fail(new Error("Snowflake OAuth credential is missing account metadata"))
    return token(account, {
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }).pipe(Effect.map((next) => credential(next, account, next.refresh_token ?? value.refresh)))
  },
  label: (value) => (typeof value.metadata?.account === "string" ? value.metadata.account : undefined),
} satisfies IntegrationOAuthMethodRegistration

function token(account: string, body: Record<string, string>) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientID}`).toString("base64")}`,
          "User-Agent": `opencode/${InstallationVersion}`,
        },
        body: new URLSearchParams(body).toString(),
        signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(`Snowflake token request failed (${response.status})${detail ? `: ${detail}` : ""}`)
      }
      return Schema.decodeUnknownSync(TokenResponse)(await response.json())
    },
    catch: (cause) => cause,
  })
}

function credential(tokens: TokenResponse, account: string, refresh: string) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: browserMethodID,
    access: tokens.access_token,
    refresh,
    expires: Date.now() + (tokens.expires_in ?? 600) * 1000,
    metadata: { account },
  })
}

function normalizeAccount(input: string) {
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.snowflakecomputing\.com\/?$/, "")
    .replace(/\/+$/, "")
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

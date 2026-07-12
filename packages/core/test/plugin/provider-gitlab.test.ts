import { AISDK } from "@opencode-ai/core/aisdk"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GitLabPlugin } from "@opencode-ai/core/plugin/provider/gitlab"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const gitlabSDKOptions: Record<string, unknown>[] = []
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GitLabPlugin.effect(host)
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

void mock.module("gitlab-ai-provider", () => ({
  VERSION: "test-version",
  createGitLab: (options: Record<string, unknown>) => {
    gitlabSDKOptions.push(options)
    return {
      agenticChat: (id: string, options: unknown) => ({ id, options, type: "agentic" }),
      workflowChat: (id: string, options: unknown) => ({ id, options, type: "workflow" }),
    }
  },
  discoverWorkflowModels: async () => ({ models: [], project: undefined }),
  isWorkflowModel: (id: string) => id === "duo-workflow" || id === "duo-workflow-exact",
}))

describe("GitLabPlugin", () => {
  it.effect("registers OAuth, PAT, and environment methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("gitlab")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("oauth"),
          type: "oauth",
          label: "GitLab OAuth",
          prompts: [
            {
              type: "text",
              key: "instanceUrl",
              message: "GitLab instance URL",
              placeholder: "https://gitlab.com",
            },
          ],
        },
        {
          type: "key",
          label: "GitLab Personal Access Token",
          prompts: [
            {
              type: "text",
              key: "instanceUrl",
              message: "GitLab instance URL",
              placeholder: "https://gitlab.com",
            },
          ],
        },
        { type: "env", names: ["GITLAB_TOKEN"] },
      ])
    }),
  )

  it.effect("validates PATs and stores normalized instance URL metadata", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const original = globalThis.fetch
      const calls: [string, RequestInit | undefined][] = []
      globalThis.fetch = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          calls.push([String(input), init])
          return new Response(JSON.stringify({ id: 1 }), { status: 200 })
        },
        { preconnect: original.preconnect },
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => (globalThis.fetch = original)))
      const integrations = yield* Integration.Service
      yield* integrations.connection.key({
        integrationID: Integration.ID.make("gitlab"),
        key: "glpat-test",
        inputs: { instanceUrl: "https://gitlab.example/path/" },
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[0]).toBe("https://gitlab.example/api/v4/user")
      expect(calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer glpat-test" })
      expect((yield* (yield* Credential.Service).list(Integration.ID.make("gitlab")))[0]?.value).toEqual({
        type: "key",
        key: "glpat-test",
        metadata: { instanceUrl: "https://gitlab.example" },
      })
    }),
  )

  it.effect("rejects invalid PAT instance URLs before validation", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const exit = yield* integrations.connection
        .key({
          integrationID: Integration.ID.make("gitlab"),
          key: "glpat-test",
          inputs: { instanceUrl: "file:///tmp/gitlab" },
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect(yield* (yield* Credential.Service).list(Integration.ID.make("gitlab"))).toHaveLength(0)
    }),
  )

  it.effect("completes OAuth PKCE and refreshes with instance metadata", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: "test-client" }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const original = globalThis.fetch
        const tokenBodies: URLSearchParams[] = []
        globalThis.fetch = Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).startsWith("http://127.0.0.1:8080/")) return original(input, init)
            tokenBodies.push(new URLSearchParams(String(init?.body)))
            return Response.json({
              access_token: tokenBodies.length === 1 ? "access" : "refreshed-access",
              refresh_token: tokenBodies.length === 1 ? "refresh" : "rotated-refresh",
              expires_in: 1,
            })
          },
          { preconnect: original.preconnect },
        )
        yield* Effect.addFinalizer(() => Effect.sync(() => (globalThis.fetch = original)))

        const integrations = yield* Integration.Service
        const attempt = yield* integrations.connection.oauth({
          integrationID: Integration.ID.make("gitlab"),
          methodID: Integration.MethodID.make("oauth"),
          inputs: { instanceUrl: "http://gitlab.example/path" },
        })
        const authorize = new URL(attempt.url)
        expect(authorize.origin).toBe("http://gitlab.example")
        expect(authorize.pathname).toBe("/oauth/authorize")
        expect(authorize.searchParams.get("client_id")).toBe("test-client")
        expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8080/callback")
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256")
        expect(authorize.searchParams.get("code_challenge")).toBeTruthy()
        yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:8080/callback?code=test-code&state=${authorize.searchParams.get("state")}`),
        )
        yield* eventually(integrations.attempt.status(attempt.attemptID), (status) => status.status === "complete")

        const saved = (yield* (yield* Credential.Service).list(Integration.ID.make("gitlab")))[0]
        expect(saved?.value).toEqual({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "access",
          refresh: "refresh",
          expires: expect.any(Number),
          metadata: { instanceUrl: "http://gitlab.example" },
        })
        expect(tokenBodies[0]?.get("grant_type")).toBe("authorization_code")
        expect(tokenBodies[0]?.get("code_verifier")).toBeTruthy()

        if (saved?.value.type !== "oauth") throw new Error("Expected OAuth credential")
        yield* (yield* Credential.Service).update(saved.id, { value: { ...saved.value, expires: 0 } })
        const resolved = yield* integrations.connection.resolve({
          type: "credential",
          id: saved!.id,
          label: saved!.label,
        })
        expect(resolved).toMatchObject({
          type: "oauth",
          access: "refreshed-access",
          refresh: "rotated-refresh",
          metadata: { instanceUrl: "http://gitlab.example" },
        })
        expect(tokenBodies[1]?.get("grant_type")).toBe("refresh_token")
        expect(tokenBodies[1]?.get("refresh_token")).toBe("refresh")
      }),
    ),
  )

  it.effect("creates SDKs with legacy default instance URL, token env, headers, and feature flags", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: undefined,
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: { name: "gitlab" },
          })
          expect(gitlabSDKOptions).toHaveLength(1)
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://gitlab.com")
          expect(gitlabSDKOptions[0].apiKey).toBe("env-token")
          expect(gitlabSDKOptions[0].aiGatewayHeaders).toMatchObject({
            "anthropic-beta": "context-1m-2025-08-07",
          })
          expect(String((gitlabSDKOptions[0].aiGatewayHeaders as Record<string, string>)["User-Agent"])).toContain(
            "gitlab-ai-provider/test-version",
          )
          expect(gitlabSDKOptions[0].featureFlags).toEqual({
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
          })
        }),
    ),
  )

  it.effect("uses GITLAB_INSTANCE_URL when instanceUrl is not configured", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: "https://env.gitlab.example",
        GITLAB_TOKEN: undefined,
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: { name: "gitlab" },
          })
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://env.gitlab.example")
        }),
    ),
  )

  it.effect("keeps configured instance URL, apiKey, aiGatewayHeaders, and featureFlags over env/defaults", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: "https://env.gitlab.example",
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: {
              name: "gitlab",
              instanceUrl: "https://configured.gitlab.example",
              apiKey: "configured-token",
              aiGatewayHeaders: {
                "anthropic-beta": "configured-beta",
                "x-gitlab-test": "1",
              },
              featureFlags: {
                duo_agent_platform: false,
                custom_flag: true,
              },
            },
          })
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://configured.gitlab.example")
          expect(gitlabSDKOptions[0].apiKey).toBe("configured-token")
          expect(gitlabSDKOptions[0].aiGatewayHeaders).toMatchObject({
            "anthropic-beta": "configured-beta",
            "x-gitlab-test": "1",
          })
          expect(gitlabSDKOptions[0].featureFlags).toEqual({
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: false,
            custom_flag: true,
          })
        }),
    ),
  )

  it.effect("ignores non-GitLab SDK packages", () =>
    Effect.gen(function* () {
      gitlabSDKOptions.length = 0
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
          modelID: ModelV2.ID.make("claude"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai",
        options: { name: "gitlab" },
      })
      expect(result.sdk).toBeUndefined()
      expect(gitlabSDKOptions).toHaveLength(0)
    }),
  )

  it.effect("uses workflowChat for duo workflow models and preserves selectedModelRef", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-custom")),
          modelID: ModelV2.ID.make("duo-workflow-custom"),
          package: "aisdk:test-provider",
          headers: {},
          settings: { workflowRef: "ref", workflowDefinition: "definition" },
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([
        ["duo-workflow", { featureFlags: { configured: true }, workflowDefinition: "definition" }],
      ])
      expect(result.language as unknown).toEqual({
        id: "duo-workflow",
        options: calls[0]?.[1],
        selectedModelRef: "ref",
      })
    }),
  )

  it.effect("uses exact static workflow model ids when the provider recognizes them", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-exact")),
          modelID: ModelV2.ID.make("duo-workflow-exact"),
          package: "aisdk:test-provider",
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([
        ["duo-workflow-exact", { featureFlags: { configured: true }, workflowDefinition: undefined }],
      ])
      expect(result.language as unknown).toEqual({ id: "duo-workflow-exact", options: calls[0]?.[1] })
    }),
  )

  it.effect("uses provider feature flags instead of model settings feature flags", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-custom")),
          modelID: ModelV2.ID.make("duo-workflow-custom"),
          package: "aisdk:test-provider",
          headers: {},
          settings: { featureFlags: { request_flag: true } },
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([["duo-workflow", { featureFlags: { configured: true }, workflowDefinition: undefined }]])
    }),
  )

  it.effect("uses agenticChat with provider aiGatewayHeaders and feature flags for normal models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
          modelID: ModelV2.ID.make("claude"),
          package: "aisdk:test-provider",
          headers: { h: "v" },
          settings: {},
        }),
        sdk: {
          workflowChat: () => undefined,
          agenticChat: (id: string, options: unknown) => {
            const selected = options as {
              aiGatewayHeaders?: Record<string, string>
              featureFlags?: Record<string, boolean>
            }
            calls.push([
              id,
              { aiGatewayHeaders: { ...selected.aiGatewayHeaders }, featureFlags: { ...selected.featureFlags } },
            ])
          },
        },
        options: { aiGatewayHeaders: { fallback: "header" }, featureFlags: { duo_agent_platform: true } },
      })
      expect(calls).toEqual([
        ["claude", { aiGatewayHeaders: { fallback: "header" }, featureFlags: { duo_agent_platform: true } }],
      ])
    }),
  )
})

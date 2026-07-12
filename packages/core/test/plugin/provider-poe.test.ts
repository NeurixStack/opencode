import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PoePlugin } from "@opencode-ai/core/plugin/provider/poe"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("poe")
const methodID = Integration.MethodID.make("browser")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* PoePlugin.effect(host)
})

describe("PoePlugin", () => {
  it.effect("registers browser OAuth and manual API key methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const integration = yield* integrations.get(integrationID)
      expect(integration?.name).toBe("Poe")
      expect(integration?.methods).toEqual([
        { id: methodID, type: "oauth", label: "Login with Poe (browser)" },
        { type: "key", label: "Manually enter API Key" },
      ])
    }),
  )

  it.effect("stores manually entered Poe API keys", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* integrations.connection.key({ integrationID, key: "poe-test" })
      expect((yield* credentials.list(integrationID))[0]?.value).toEqual({ type: "key", key: "poe-test" })
    }),
  )

  it.effect("starts a PKCE browser authorization on an ephemeral loopback server", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const attempt = yield* integrations.connection.oauth({ integrationID, methodID, inputs: {} })
      const url = new URL(attempt.url)
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")

      expect(url.origin + url.pathname).toBe("https://poe.com/oauth/authorize")
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
      expect(url.searchParams.get("scope")).toBe("apikey:create")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(redirect.hostname).toBe("127.0.0.1")
      expect(redirect.pathname).toBe("/callback")
      expect(Number(redirect.port)).toBeGreaterThan(0)

      yield* integrations.attempt.cancel(attempt.attemptID)
    }),
  )
})

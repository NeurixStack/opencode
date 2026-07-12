import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { DigitalOceanPlugin } from "@opencode-ai/core/plugin/provider/digitalocean"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("digitalocean")
const providerID = ProviderV2.ID.make("digitalocean")

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* DigitalOceanPlugin.effect(host)
})

describe("DigitalOceanPlugin", () => {
  it.effect("registers implicit OAuth and manual model access keys", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(integrationID))?.methods).toEqual([
        {
          id: Integration.MethodID.make("implicit"),
          type: "oauth",
          label: "Login with DigitalOcean",
        },
        { type: "key", label: "Paste Model Access Key" },
      ])
    }),
  )

  it.effect("adds cached inference routers to the DigitalOcean catalog", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.name = "DigitalOcean"
        })
      })
      yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("implicit"),
          refresh: "token",
          access: "token",
          expires: Date.now() + 60_000,
          metadata: {
            routers: [
              { name: "production", uuid: "router-1" },
              { name: "support", description: "Support router" },
            ],
            routersFetchedAt: Date.now(),
          },
        }),
      })

      yield* addPlugin()

      const model = yield* catalog.model.get(providerID, ModelV2.ID.make("router:production"))
      expect(model).toMatchObject({
        id: "router:production",
        modelID: "router:production",
        providerID: "digitalocean",
        name: "production",
        family: "digitalocean-inference-routers",
        package: ProviderV2.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: "https://inference.do-ai.run/v1" },
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 128_000, output: 8_192 },
      })
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("router:support"))).toBeDefined()
    }),
  )

  it.effect("stores a manually registered model access key", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      yield* integrations.connection.key({ integrationID, key: "model-access-key" })
      expect((yield* (yield* Credential.Service).list(integrationID))[0]?.value).toEqual({
        type: "key",
        key: "model-access-key",
      })
    }),
  )
})

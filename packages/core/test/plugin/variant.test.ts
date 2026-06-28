import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { Policy } from "@opencode-ai/core/policy"
import { VariantPlugin } from "@opencode-ai/core/plugin/variant"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host } from "./host"

const events = EventV2.defaultLayer
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const connections = Credential.defaultLayer.pipe(Layer.fresh)
const integrations = Integration.locationLayer.pipe(Layer.provide(events), Layer.provide(connections))
const catalog = Catalog.layer.pipe(
  Layer.provide(
    Layer.mergeAll(events, locationLayer, Policy.layer.pipe(Layer.provide(locationLayer)), connections, integrations),
  ),
)
const it = testEffect(
  Layer.mergeAll(catalog.pipe(Layer.provide(connections)), integrations, connections, events, locationLayer),
)

describe("VariantPlugin", () => {
  it.effect("adds GLM 5.2 variants after catalog sources", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.opencode, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", body: { reasoning_effort: "high" } }),
        expect.objectContaining({ id: "max", body: { reasoning_effort: "max" } }),
      ])
    }),
  )

  it.effect("keeps explicit variants over generated defaults", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
          model.variants = [{ id: ModelV2.VariantID.make("high"), headers: { custom: "true" }, body: {} }]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        expect.objectContaining({ id: "max", body: { reasoning_effort: "max" } }),
      ])
    }),
  )

  it.effect("adds Anthropic thinking variants for reasoning models", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("claude-opus-4-8"), (model) => {
          model.api = {
            id: ModelV2.ID.make("claude-opus-4-8"),
            type: "aisdk",
            package: "@ai-sdk/anthropic",
          }
          model.capabilities.reasoning = true
          model.limit = { context: 200_000, output: 64_000 }
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("claude-opus-4-8")))?.variants).toEqual([
        expect.objectContaining({ id: "high", body: { thinking: { type: "enabled", budget_tokens: 16_000 } } }),
        expect.objectContaining({ id: "max", body: { thinking: { type: "enabled", budget_tokens: 31_999 } } }),
      ])
    }),
  )

  it.effect("clamps Anthropic thinking budgets to the output limit", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("claude-haiku-4-5"), (model) => {
          model.api = {
            id: ModelV2.ID.make("claude-haiku-4-5"),
            type: "aisdk",
            package: "@ai-sdk/anthropic",
          }
          model.capabilities.reasoning = true
          model.limit = { context: 200_000, output: 8_000 }
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("claude-haiku-4-5")))?.variants).toEqual(
        [
          expect.objectContaining({ id: "high", body: { thinking: { type: "enabled", budget_tokens: 7_999 } } }),
          expect.objectContaining({ id: "max", body: { thinking: { type: "enabled", budget_tokens: 7_999 } } }),
        ],
      )
    }),
  )

  it.effect("skips Anthropic models without reasoning capability", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("claude-3-5-haiku"), (model) => {
          model.api = {
            id: ModelV2.ID.make("claude-3-5-haiku"),
            type: "aisdk",
            package: "@ai-sdk/anthropic",
          }
          model.capabilities.reasoning = false
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("claude-3-5-haiku")))?.variants).toEqual(
        [],
      )
    }),
  )
})

import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelsDevPlugin } from "@opencode-ai/core/plugin/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const model = (input: Partial<ModelsDev.Model> & { id: string }): ModelsDev.Model => ({
  name: input.id,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: true,
  temperature: true,
  tool_call: true,
  limit: { context: 200_000, output: 64_000 },
  ...input,
})

const fixture: Record<string, ModelsDev.Provider> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: [],
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-sonnet-4-6": model({
        id: "claude-sonnet-4-6",
        reasoning_options: [
          { type: "effort", values: ["low", "medium", "high", "max"] },
          { type: "budget_tokens", min: 1024 },
        ],
      }),
    },
  },
  compat: {
    id: "compat",
    name: "Compat",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    models: {
      "deepseek-v4": model({
        id: "deepseek-v4",
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: [null, "high", "max"] }],
        experimental: {
          modes: {
            high: { provider: { body: { reasoning_effort: "high", custom: true } } },
          },
        },
      }),
    },
  },
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const modelsDevLayer = Layer.succeed(
  ModelsDev.Service,
  ModelsDev.Service.of({
    get: () => Effect.succeed(fixture),
    refresh: () => Effect.void,
  }),
)
const it = testEffect(
  Layer.mergeAll(modelsDevLayer, Catalog.locationLayer).pipe(
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(locationLayer),
  ),
)

describe("ModelsDevPlugin reasoning_options", () => {
  it.effect("generates anthropic effort variants as semantic thinking + effort options", () =>
    Effect.gen(function* () {
      yield* ModelsDevPlugin.effect
      const catalog = yield* Catalog.Service
      const info = yield* catalog.model.get(ProviderV2.ID.make("anthropic"), ModelV2.ID.make("claude-sonnet-4-6"))
      expect(info.variants.map((variant) => variant.id)).toEqual(
        ["low", "medium", "high", "max"].map((id) => ModelV2.VariantID.make(id)),
      )
      expect(info.variants[2]).toMatchObject({
        id: "high",
        headers: {},
        body: {},
        options: { thinking: { type: "adaptive" }, effort: "high" },
      })
    }),
  )

  it.effect("merges effort variants after curated experimental modes, skipping null values and collisions", () =>
    Effect.gen(function* () {
      yield* ModelsDevPlugin.effect
      const catalog = yield* Catalog.Service
      const info = yield* catalog.model.get(ProviderV2.ID.make("compat"), ModelV2.ID.make("deepseek-v4"))
      expect(info.variants.map((variant) => variant.id)).toEqual(["high", "max"].map((id) => ModelV2.VariantID.make(id)))
      // curated mode wins the "high" id; its body keys survive partitioning
      expect(info.variants[0]).toMatchObject({
        id: "high",
        body: { custom: true },
        options: { reasoningEffort: "high" },
      })
      // data-driven effort variant for "max" uses the openai-compatible encoding
      expect(info.variants[1]).toMatchObject({
        id: "max",
        body: {},
        options: { reasoningEffort: "max" },
      })
    }),
  )
})

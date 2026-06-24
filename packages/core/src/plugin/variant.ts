export * as VariantPlugin from "./variant"

import { Effect } from "effect"
import { ModelV2 } from "../model"
import { define } from "./internal"

export const Plugin = define({
  id: "variant",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          catalog.model.update(model.providerID, model.id, (draft) => {
            const generated = generate(draft as ModelV2.Info, record.provider)
            if (generated.length === 0) return

            const explicit = new Map((draft.variants ?? []).map((variant) => [variant.id, variant]))
            const generatedIDs = new Set<string>(generated.map((variant) => variant.id))
            draft.variants = [
              ...generated.map((variant) => explicit.get(variant.id) ?? variant),
              ...(draft.variants ?? []).filter((variant) => !generatedIDs.has(variant.id)),
            ]
          })
        }
      }
    })
  }),
})

export function generate(
  model: ModelV2.Info,
  provider?: { readonly package: string; readonly aisdk?: true },
): NonNullable<ModelV2.Info["variants"]> {
  if (!(model.aisdk ?? provider?.aisdk) || (model.package ?? provider?.package) !== "@ai-sdk/openai-compatible") return []
  const ids = `${model.id} ${model.modelID ?? ""}`.toLowerCase()
  if (!["glm-5.2", "glm-5-2", "glm-5p2"].some((name) => ids.includes(name))) return []
  return ["high", "max"].map((id) => ({
    id: ModelV2.VariantID.make(id),
    settings: { reasoningEffort: id },
  }))
}

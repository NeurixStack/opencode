import { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "delayed-catalog",
  effect: Effect.fn(function* (ctx) {
    yield* Effect.sleep("300 millis")
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("delayed-provider", (provider) => {
        provider.name = "Delayed Provider"
      })
      catalog.model.update("delayed-provider", "delayed-model", (model) => {
        model.name = "Delayed Model"
        model.enabled = true
      })
    })
  }),
})

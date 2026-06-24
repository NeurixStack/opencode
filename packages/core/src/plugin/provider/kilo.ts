import { Effect } from "effect"
import { define } from "../internal"

export const KiloPlugin = define({
  id: "kilo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (!item.provider.aisdk) continue
          if (item.provider.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.settings?.baseURL !== "https://api.kilo.ai/api/gateway") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.headers = { ...provider.headers, "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" }
          })
        }
      }),
    )
  }),
})

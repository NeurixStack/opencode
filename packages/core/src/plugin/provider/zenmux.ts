import { Effect } from "effect"
import { define } from "../internal"

export const ZenmuxPlugin = define({
  id: "zenmux",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          if (!item.provider.aisdk) continue
          if (item.provider.package !== "@ai-sdk/openai-compatible") continue
          if (item.provider.settings?.baseURL !== "https://zenmux.ai/api/v1") continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.headers = {
              "HTTP-Referer": "https://opencode.ai/",
              "X-Title": "opencode",
              ...provider.headers,
            }
          })
        }
      }),
    )
  }),
})

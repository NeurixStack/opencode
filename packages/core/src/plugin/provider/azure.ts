import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider"

function selectLanguage(sdk: any, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) return sdk.chat(modelID)
  if (sdk.responses) return sdk.responses(modelID)
  if (sdk.messages) return sdk.messages(modelID)
  if (sdk.chat) return sdk.chat(modelID)
  return sdk.languageModel(modelID)
}

export const AzurePlugin = define({
  id: "opencode.provider.azure",
  effect: Effect.fn(function* (ctx) {
    const integration = yield* Integration.Service
    yield* integration.transform((draft) => {
      draft.method.update({
        integrationID: Integration.ID.make("azure"),
        method: {
          type: "key",
          label: "API key",
          prompts: process.env.AZURE_RESOURCE_NAME
            ? []
            : [
                {
                  type: "text",
                  key: "resourceName",
                  message: "Enter Azure Resource Name",
                  placeholder: "e.g. my-models",
                },
              ],
        },
        authorize: (key, inputs) =>
          Effect.succeed(
            Credential.Key.make({
              type: "key",
              key,
              ...(inputs.resourceName ? { metadata: { resourceName: inputs.resourceName } } : {}),
            }),
          ),
      })
    })
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!ProviderV2.isAISDK(item.provider.package)) continue
        if (ProviderV2.packageName(item.provider.package) !== "@ai-sdk/azure") continue
        const configured = item.provider.settings?.resourceName
        const resourceName =
          typeof configured === "string" && configured.trim() !== "" ? configured : process.env.AZURE_RESOURCE_NAME
        if (!resourceName) continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.settings = { ...provider.settings, resourceName }
        })
      }
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/azure") return
        if (evt.model.providerID === ProviderV2.ID.azure) {
          if (
            !evt.options.resourceName &&
            !evt.options.baseURL &&
            (!ProviderV2.isAISDK(evt.model.package) || typeof evt.model.settings?.baseURL !== "string")
          ) {
            throw new Error(
              "AZURE_RESOURCE_NAME is missing, set it using env var or reconnecting the azure provider and setting it",
            )
          }
        }
        const mod = yield* Effect.promise(() => import("@ai-sdk/azure"))
        evt.sdk = mod.createAzure(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.azure) return
        evt.language = selectLanguage(
          evt.sdk,
          evt.model.modelID ?? evt.model.id,
          Boolean(evt.options.useCompletionUrls),
        )
      }),
    )
  }),
})

export const AzureCognitiveServicesPlugin = define({
  id: "opencode.provider.azure-cognitive-services",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      const resourceName = process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
      if (!resourceName) return
      for (const item of evt.provider.list()) {
        if (!ProviderV2.isAISDK(item.provider.package)) continue
        if (ProviderV2.packageName(item.provider.package) !== "@ai-sdk/openai-compatible") continue
        if (!item.provider.id.includes("azure-cognitive-services")) continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.settings = {
            ...provider.settings,
            baseURL: `https://${resourceName}.cognitiveservices.azure.com/openai`,
          }
        })
      }
    })
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("azure-cognitive-services")) return
        evt.language = selectLanguage(
          evt.sdk,
          evt.model.modelID ?? evt.model.id,
          Boolean(evt.options.useCompletionUrls),
        )
      }),
    )
  }),
})

export * as ConfigProviderPlugin from "./provider"

import { define } from "../../plugin/internal"
import { Effect } from "effect"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { ModelRequest } from "../../model-request"
import { ProviderV2 } from "../../provider"

export const Plugin = define({
  id: "config-provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        const files = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
        const configuredIntegrations = new Set(
          files.flatMap((file) =>
            Object.entries(file.info.providers ?? {}).flatMap(([id, provider]) =>
              provider.env === undefined ? [] : [id],
            ),
          ),
        )
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const integrationID = id
            if (!configuredIntegrations.has(id) && !integrations.get(integrationID)) continue
            integrations.update(integrationID, (integration) => {
              integration.name = item.name ?? integration.name
            })
            if (item.env !== undefined) {
              integrations.method.update({
                integrationID,
                method: { type: "env", names: [...item.env] },
              })
            }
          }
        }
      }),
    )

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const entries = yield* config.entries()
        const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
        const configuredDefault = Config.latest(entries, "model")
        if (configuredDefault !== undefined) {
          const model = ModelV2.parse(configuredDefault)
          catalog.model.default.set(model.providerID, model.modelID)
        }
        const providerAiSDK = new Map<string, boolean>()
        const modelAiSDK = new Map<string, boolean>()
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const providerID = id
            if (item.aiSDK !== undefined) providerAiSDK.set(providerID, item.aiSDK)
            catalog.provider.update(providerID, (provider) => {
              if (item.name !== undefined) provider.name = item.name
              if (item.package !== undefined) {
                const settings = ModelRequest.mergeRecords(provider.api.settings, item.settings)
                const url =
                  item.settings && Object.hasOwn(item.settings, "baseURL")
                    ? typeof settings.baseURL === "string"
                      ? settings.baseURL
                      : undefined
                    : provider.api.url
                provider.api = (providerAiSDK.get(providerID) ?? provider.api.type === "aisdk")
                  ? { type: "aisdk", package: item.package, ...(url === undefined ? {} : { url }), settings }
                  : { type: "native", package: item.package, ...(url === undefined ? {} : { url }), settings }
              } else if (item.settings !== undefined) {
                provider.api.settings = ModelRequest.mergeRecords(provider.api.settings, item.settings)
                if (Object.hasOwn(item.settings, "baseURL")) {
                  provider.api.url =
                    typeof provider.api.settings.baseURL === "string" ? provider.api.settings.baseURL : undefined
                }
              }
              if (item.package === undefined && item.aiSDK !== undefined) {
                if (item.aiSDK && provider.api.type === "native" && provider.api.package !== undefined) {
                  provider.api = { ...provider.api, type: "aisdk", package: provider.api.package }
                }
                if (!item.aiSDK && provider.api.type === "aisdk") {
                  provider.api = { ...provider.api, type: "native", settings: provider.api.settings ?? {} }
                }
              }
              ModelRequest.assign(provider.request, { headers: item.headers, body: item.body })
            })
            const providerApi = catalog.provider.get(providerID)?.provider.api
            const providerPackage = providerApi?.type === "aisdk" ? providerApi.package : undefined

            for (const [id, config] of Object.entries(item.models ?? {})) {
              const modelKey = `${providerID}/${id}`
              if (config.aiSDK !== undefined) modelAiSDK.set(modelKey, config.aiSDK)
              catalog.model.update(providerID, id, (model) => {
                if (config.family !== undefined) model.family = config.family
                if (config.name !== undefined) model.name = config.name
                if (config.id !== undefined) model.api.id = config.id
                if (config.package !== undefined) {
                  const aiSDK =
                    modelAiSDK.get(modelKey) ?? providerAiSDK.get(providerID) ?? providerApi?.type === "aisdk"
                  const settings = ModelRequest.mergeRecords(model.api.settings, config.settings)
                  const url =
                    config.settings && Object.hasOwn(config.settings, "baseURL")
                      ? typeof settings.baseURL === "string"
                        ? settings.baseURL
                        : undefined
                      : model.api.url
                  model.api = aiSDK
                    ? {
                        id: model.api.id,
                        type: "aisdk",
                        package: config.package,
                        ...(url === undefined ? {} : { url }),
                        settings,
                      }
                    : {
                        id: model.api.id,
                        type: "native",
                        package: config.package,
                        ...(url === undefined ? {} : { url }),
                        settings,
                      }
                } else if (config.settings !== undefined) {
                  model.api.settings = ModelRequest.mergeRecords(model.api.settings, config.settings)
                  if (Object.hasOwn(config.settings, "baseURL")) {
                    model.api.url =
                      typeof model.api.settings.baseURL === "string" ? model.api.settings.baseURL : undefined
                  }
                }
                if (config.package === undefined && config.aiSDK !== undefined) {
                  if (config.aiSDK && model.api.type === "native" && model.api.package !== undefined) {
                    model.api = { ...model.api, type: "aisdk", package: model.api.package }
                  }
                  if (!config.aiSDK && model.api.type === "aisdk") {
                    model.api = { ...model.api, type: "native", settings: model.api.settings ?? {} }
                  }
                }
                const packageName = model.api.type === "aisdk" ? model.api.package : providerPackage
                const aiSDK =
                  modelAiSDK.get(modelKey) ?? providerAiSDK.get(providerID) ?? providerApi?.type === "aisdk"
                if (config.capabilities !== undefined) {
                  model.capabilities = {
                    tools: config.capabilities.tools,
                    input: [...config.capabilities.input],
                    output: [...config.capabilities.output],
                  }
                }
                if (config.headers !== undefined || config.body !== undefined) {
                  ModelRequest.assign(model.request, {
                    headers: config.headers,
                    ...(aiSDK
                      ? ModelRequest.normalizeAiSdkOptions(packageName, config.body ?? {})
                      : { body: config.body }),
                  })
                }
                if (config.variant !== undefined) model.request.variant = config.variant
                if (config.variants !== undefined) {
                  for (const variant of config.variants) {
                    let existing = model.variants.find((item) => item.id === variant.id)
                    if (!existing) {
                      existing = {
                        id: variant.id,
                        settings: {},
                        headers: {},
                        body: {},
                        generation: {},
                        options: {},
                      }
                      model.variants.push(existing)
                    }
                    existing.settings = ModelRequest.mergeRecords(existing.settings, variant.settings)
                    ModelRequest.assign(existing, {
                      headers: variant.headers,
                      ...(aiSDK
                        ? ModelRequest.normalizeAiSdkOptions(packageName, variant.body ?? {})
                        : { body: variant.body }),
                    })
                  }
                }
                if (config.cost !== undefined) {
                  model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                    tier: cost.tier && { ...cost.tier },
                    input: cost.input,
                    output: cost.output,
                    cache: {
                      read: cost.cache?.read ?? 0,
                      write: cost.cache?.write ?? 0,
                    },
                  }))
                }
                if (config.disabled !== undefined) model.enabled = !config.disabled
                if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
              })
            }
          }
        }
      }),
    )
  }),
})

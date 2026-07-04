import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const catalogLayer = AppNodeBuilder.build(
  LayerNode.group([Catalog.node, EventV2.node, Credential.node, Integration.node]),
  [[Location.node, locationLayer]],
)
const it = testEffect(catalogLayer)
const sessionModelLayer = AppNodeBuilder.build(
  LayerNode.group([Catalog.node, EventV2.node, Credential.node, Integration.node, SessionRunnerModel.node]),
  [[Location.node, locationLayer]],
)
const sessionModelIt = testEffect(sessionModelLayer)

const session = (providerID?: ProviderV2.ID, modelID?: ModelV2.ID) =>
  SessionV2.Info.make({
    id: SessionV2.ID.make("ses_catalog_readiness"),
    projectID: ProjectV2.ID.global,
    title: "test",
    ...(providerID === undefined || modelID === undefined ? {} : { model: { providerID, id: modelID } }),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make("test") },
  })

const addSupportedModel = (catalog: Catalog.Interface, providerID: ProviderV2.ID, modelID: ModelV2.ID) =>
  catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.api = { type: "aisdk", package: "@ai-sdk/openai", settings: {} }
    })
    draft.model.update(providerID, modelID, () => {})
  })

describe("CatalogV2", () => {
  it.effect("keeps available snapshots nonblocking during initial catalog work", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const release = yield* Deferred.make<void>()
      yield* catalog.initial.discover(catalog.initial.source(Deferred.await(release)))

      expect(yield* catalog.model.available()).toEqual([])

      yield* Deferred.succeed(release, undefined)
    }),
  )

  it.effect("waits until an explicit model appears", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("delayed-provider")
      const modelID = ModelV2.ID.make("delayed-model")
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<ModelV2.Info | undefined>()
      yield* catalog.initial.discover(
        catalog.initial.source(
          Deferred.await(release).pipe(Effect.andThen(addSupportedModel(catalog, providerID, modelID))),
        ),
      )
      const selected = yield* catalog.model
        .select(ModelV2.Ref.make({ providerID, id: modelID }), () => true)
        .pipe(
          Effect.tap((model) => Deferred.succeed(completed, model)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(release, undefined)

      expect((yield* Fiber.join(selected))?.id).toBe(modelID)
    }),
  )

  it.effect("waits for discovery contributors before returning an existing explicit model", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("overlaid-provider")
      const modelID = ModelV2.ID.make("overlaid-model")
      const modelVisible = yield* Deferred.make<void>()
      const releaseOverlay = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<ModelV2.Info | undefined>()
      yield* catalog.initial
        .discover(
          Effect.gen(function* () {
            yield* addSupportedModel(catalog, providerID, modelID)
            yield* Deferred.succeed(modelVisible, undefined)
            yield* Deferred.await(releaseOverlay)
            yield* catalog.transform((draft) =>
              draft.model.update(providerID, modelID, (model) => {
                model.name = "Configured model"
              }),
            )
          }),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(modelVisible)
      const selected = yield* catalog.model
        .select(ModelV2.Ref.make({ providerID, id: modelID }), () => true)
        .pipe(
          Effect.tap((model) => Deferred.succeed(completed, model)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(releaseOverlay, undefined)

      expect((yield* Fiber.join(selected))?.name).toBe("Configured model")
    }),
  )

  it.effect("selects an explicit model as soon as it arrives without waiting for unrelated initial work", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("ready-provider")
      const modelID = ModelV2.ID.make("ready-model")
      const releaseModel = yield* Deferred.make<void>()
      const releaseUnrelated = yield* Deferred.make<void>()
      yield* catalog.initial.discover(
        Effect.gen(function* () {
          yield* catalog.initial.source(
            Deferred.await(releaseModel).pipe(Effect.andThen(addSupportedModel(catalog, providerID, modelID))),
          )
          yield* catalog.initial.source(Deferred.await(releaseUnrelated))
        }),
      )
      const selected = yield* catalog.model
        .select(ModelV2.Ref.make({ providerID, id: modelID }), () => true)
        .pipe(Effect.forkScoped({ startImmediately: true }))

      yield* Deferred.succeed(releaseModel, undefined)

      expect((yield* Fiber.join(selected))?.id).toBe(modelID)
      expect(yield* Deferred.isDone(releaseUnrelated)).toBe(false)
      yield* Deferred.succeed(releaseUnrelated, undefined)
    }),
  )

  it.effect("waits for a pending source after another initial source fails", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("recovering-provider")
      const modelID = ModelV2.ID.make("recovering-model")
      const releaseModel = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<ModelV2.Info | undefined>()
      yield* catalog.initial.discover(
        Effect.gen(function* () {
          yield* catalog.initial.source(Effect.fail(new Error("unrelated source failed")))
          yield* catalog.initial.source(
            Deferred.await(releaseModel).pipe(Effect.andThen(addSupportedModel(catalog, providerID, modelID))),
          )
        }),
      )
      const selected = yield* catalog.model
        .select(ModelV2.Ref.make({ providerID, id: modelID }), () => true)
        .pipe(
          Effect.tap((model) => Deferred.succeed(completed, model)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(releaseModel, undefined)

      expect((yield* Fiber.join(selected))?.id).toBe(modelID)
    }),
  )

  it.effect("waits for a pending source after discovery fails", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("discovery-failure-provider")
      const modelID = ModelV2.ID.make("discovery-failure-model")
      const releaseModel = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<ModelV2.Info | undefined>()
      yield* catalog.initial.discover(
        Effect.gen(function* () {
          yield* catalog.initial.source(
            Deferred.await(releaseModel).pipe(Effect.andThen(addSupportedModel(catalog, providerID, modelID))),
          )
          return yield* Effect.fail(new Error("discovery failed after source registration"))
        }),
      )
      const selected = yield* catalog.model
        .select(ModelV2.Ref.make({ providerID, id: modelID }), () => true)
        .pipe(
          Effect.tap((model) => Deferred.succeed(completed, model)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(releaseModel, undefined)

      expect((yield* Fiber.join(selected))?.id).toBe(modelID)
    }),
  )

  it.effect("observes discovery settlement completed before lookup subscribes", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.initial.discover(Effect.void)

      const selected = yield* catalog.model.select(
        ModelV2.Ref.make({ providerID: ProviderV2.ID.make("missing"), id: ModelV2.ID.make("missing") }),
        () => true,
      )

      expect(selected).toBeUndefined()
    }),
  )

  it.effect("waits for initial settlement before choosing an omitted model", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const earlyProviderID = ProviderV2.ID.make("early-provider")
      const earlyModelID = ModelV2.ID.make("early-model")
      const finalProviderID = ProviderV2.ID.make("final-provider")
      const finalModelID = ModelV2.ID.make("final-model")
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<ModelV2.Info | undefined>()
      yield* addSupportedModel(catalog, earlyProviderID, earlyModelID)
      yield* catalog.initial.discover(
        catalog.initial.source(
          Deferred.await(release).pipe(
            Effect.andThen(
              catalog.transform((draft) => {
                draft.provider.update(finalProviderID, (provider) => {
                  provider.api = { type: "aisdk", package: "@ai-sdk/openai", settings: {} }
                })
                draft.model.update(finalProviderID, finalModelID, () => {})
                draft.model.default.set(finalProviderID, finalModelID)
              }),
            ),
          ),
        ),
      )
      const selected = yield* catalog.model
        .select(undefined, () => true)
        .pipe(
          Effect.tap((model) => Deferred.succeed(completed, model)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(release, undefined)

      expect((yield* Fiber.join(selected))?.id).toBe(finalModelID)
    }),
  )

  sessionModelIt.effect("reports an unavailable explicit model after successful initial settlement", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const models = yield* SessionRunnerModel.Service
      const providerID = ProviderV2.ID.make("missing")
      const modelID = ModelV2.ID.make("missing")
      yield* catalog.initial.discover(Effect.void)

      const failure = yield* models.resolve(session(providerID, modelID)).pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionRunnerModel.ModelUnavailableError",
        providerID,
        modelID,
      })
    }),
  )

  sessionModelIt.effect("reports catalog incompleteness when a source fails after discovery settles", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const models = yield* SessionRunnerModel.Service
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<SessionRunnerModel.Error>()
      yield* catalog.initial.discover(
        catalog.initial.source(
          Deferred.await(release).pipe(Effect.andThen(Effect.fail(new Error("initial source failed")))),
        ),
      )
      const result = yield* models
        .resolve(session(ProviderV2.ID.make("missing"), ModelV2.ID.make("missing")))
        .pipe(
          Effect.flip,
          Effect.tap((failure) => Deferred.succeed(completed, failure)),
          Effect.forkScoped({ startImmediately: true }),
        )

      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* Deferred.succeed(release, undefined)

      const failure = yield* Fiber.join(result)

      expect(failure).toMatchObject({ _tag: "Catalog.IncompleteError" })
    }),
  )

  it.effect("settles interrupted initial sources as incomplete", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const sourceScope = yield* Scope.make()
      const started = yield* Deferred.make<void>()
      yield* catalog.initial.discover(
        catalog.initial
          .source(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
          .pipe(Scope.provide(sourceScope)),
      )
      yield* Deferred.await(started)

      yield* Scope.close(sourceScope, Exit.void)

      const failure = yield* catalog.model
        .select(
          ModelV2.Ref.make({ providerID: ProviderV2.ID.make("missing"), id: ModelV2.ID.make("missing") }),
          () => true,
        )
        .pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: "Catalog.IncompleteError" })
    }),
  )

  sessionModelIt.effect("preserves the supported-model fallback after initial settlement", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const models = yield* SessionRunnerModel.Service
      const unsupportedProviderID = ProviderV2.ID.make("unsupported-provider")
      const unsupportedModelID = ModelV2.ID.make("unsupported-model")
      const supportedProviderID = ProviderV2.ID.make("supported-provider")
      const supportedModelID = ModelV2.ID.make("supported-model")
      yield* catalog.transform((draft) => {
        draft.provider.update(unsupportedProviderID, () => {})
        draft.model.update(unsupportedProviderID, unsupportedModelID, () => {})
        draft.model.default.set(unsupportedProviderID, unsupportedModelID)
        draft.provider.update(supportedProviderID, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai", settings: {} }
        })
        draft.model.update(supportedProviderID, supportedModelID, () => {})
      })
      yield* catalog.initial.discover(Effect.void)

      const selected = yield* models.resolve(session())

      expect(selected.ref).toMatchObject({ providerID: supportedProviderID, id: supportedModelID })
    }),
  )

  it.effect("publishes an updated event after catalog changes", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const events = yield* EventV2.Service
      const updated = yield* events
        .subscribe(Catalog.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))

      expect((yield* Fiber.join(updated)).length).toBe(1)
    }),
  )

  it.effect("derives availability from active credentials without changing provider state", () => {
    const integrationID = Integration.ID.make("test")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node]), [[Location.node, locationLayer]]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
      yield* credentials.create({
        integrationID,
        label: "First",
        value: Credential.Key.make({ type: "key", key: "first", metadata: { tenant: "one" } }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).request.body).toEqual({})
      yield* credentials.create({
        integrationID,
        label: "Second",
        value: Credential.Key.make({ type: "key", key: "second", metadata: { tenant: "two" } }),
      })
      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).request.body).toEqual({})
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("derives availability from a provider's integration", () => {
    const integrationID = Integration.ID.make("gateway")
    const providerID = ProviderV2.ID.make("remote")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node, Integration.node]), [
        [Location.node, locationLayer],
      ]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* (yield* Integration.Service).transform((editor) => editor.update(integrationID, () => {}))
      yield* catalog.transform((editor) =>
        editor.provider.update(providerID, (provider) => {
          provider.integrationID = integrationID
        }),
      )
      expect(yield* catalog.provider.available()).toEqual([])

      yield* (yield* Credential.Service).create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([providerID])
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("projects environment connections without a catalog plugin", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.CATALOG_TEST_API_KEY
        process.env.CATALOG_TEST_API_KEY = "secret"
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          const providerID = ProviderV2.ID.make("test")
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: Integration.ID.make(providerID),
              method: { type: "env", names: ["CATALOG_TEST_API_KEY"] },
            }),
          )
          yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))

          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(providerID)
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CATALOG_TEST_API_KEY
          else process.env.CATALOG_TEST_API_KEY = previous
        }),
    ),
  )

  it.effect("normalizes provider baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://default.example.com",
          }
          provider.request.body.baseURL = "https://override.example.com"
        }),
      )

      expect(required(yield* catalog.provider.get(providerID)).api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
      })
    }),
  )

  it.effect("normalizes model baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.api = {
            id: modelID,
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://model.example.com",
          }
          model.request.body.baseURL = "https://override.example.com"
        })
      })

      expect(required(yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
        settings: {},
      })
    }),
  )

  it.effect("resolves default model api from provider api", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, () => {})
      })

      expect(required(yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://provider.example.com",
      })
    }),
  )

  it.effect("resolves provider and model request merges", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.request.headers.provider = "provider"
          provider.request.headers.shared = "provider"
          provider.request.body.provider = true
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.request.headers.model = "model"
          model.request.headers.shared = "model"
          model.request.body.model = true
          model.request.body.request = true
          model.request.body.shared = "model"
        })
      })

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.request.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.request.body).toEqual({ provider: true, model: true, request: true, shared: "model" })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("old"), (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, ModelV2.ID.make("new"), (model) => {
          model.time.released = 2000
        })
      })

      expect((yield* catalog.model.default())?.id).toMatch("new")
    }),
  )

  it.effect("uses a transform-provided default model until that transform is replaced", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const old = ModelV2.ID.make("old")
      const newest = ModelV2.ID.make("new")
      const models = (catalog: Catalog.Draft) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, old, (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, newest, (model) => {
          model.time.released = 2000
        })
      }

      let configured = true
      yield* catalog.transform((catalog) => {
        models(catalog)
        if (configured) catalog.model.default.set(providerID, old)
      })
      expect((yield* catalog.model.default())?.id).toBe(old)

      configured = false
      yield* catalog.reload()
      expect((yield* catalog.model.default())?.id).toBe(newest)
    }),
  )

  it.effect("ignores a configured default on a disabled provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const disabledProvider = ProviderV2.ID.make("disabled")
      const enabledProvider = ProviderV2.ID.make("enabled")
      const disabledModel = ModelV2.ID.make("configured")
      const fallbackModel = ModelV2.ID.make("fallback")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(disabledProvider, (provider) => {
          provider.disabled = true
        })
        catalog.model.update(disabledProvider, disabledModel, () => {})
        catalog.provider.update(enabledProvider, () => {})
        catalog.model.update(enabledProvider, fallbackModel, () => {})
        catalog.model.default.set(disabledProvider, disabledModel)
      })

      expect(yield* catalog.model.default()).toMatchObject({
        providerID: enabledProvider,
        id: fallbackModel,
      })
    }),
  )

  it.effect("small model prefers small keyword candidates before cost scoring", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-large"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 1, output: 1, cache: { read: 0, write: 0 } }]
          model.time.released = Date.now()
        })
        catalog.model.update(providerID, ModelV2.ID.make("expensive-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 10, output: 10, cache: { read: 0, write: 0 } }]
          model.time.released = Date.now()
        })
      })

      expect((yield* catalog.model.small(providerID))?.id).toMatch("expensive-mini")
    }),
  )
})

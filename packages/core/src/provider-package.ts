export * as ProviderPackage from "./provider-package"

import { Effect, Option, Schema } from "effect"
import { pathToFileURL } from "url"
import type { Model, ProviderPackageDefinition, ProviderPackageSettings } from "@opencode-ai/llm"
import { Npm } from "./npm"

const cache = new Map<string, Promise<unknown>>()

export class LoadError extends Schema.TaggedErrorClass<LoadError>()("ProviderPackage.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}

export const load = Effect.fn("ProviderPackage.load")(function* (specifier: string) {
  const npm = Option.getOrUndefined(yield* Effect.serviceOption(Npm.Service))
  const resolved =
    specifier.startsWith("file://") || specifier.startsWith("@opencode-ai/llm/")
      ? specifier
      : yield* Effect.sync(() => {
          try {
            return import.meta.resolve(specifier)
          } catch {
            return undefined
          }
        })
  if (resolved) return yield* importProviderPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const installed = yield* npm
    .add(packageName(specifier))
    .pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => import.meta.resolve(specifier, pathToFileURL(`${installed.directory}/`).href),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importProviderPackage(specifier, entrypoint)
})

const importProviderPackage = Effect.fn("ProviderPackage.import")(function* (specifier: string, entrypoint: string) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = cache.get(entrypoint)
      if (existing) return existing
      const loaded = import(entrypoint)
      cache.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (!isProviderPackage(module)) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(id, settings)`),
    })
  }
  return module
})

export const make = (module: ProviderPackageDefinition, modelID: string, settings: ProviderPackageSettings): Model =>
  module.model(modelID, settings)

function isProviderPackage(input: unknown): input is ProviderPackageDefinition {
  return typeof input === "object" && input !== null && "model" in input && typeof input.model === "function"
}

function packageName(specifier: string) {
  const parts = specifier.split("/")
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/")
  return parts[0]
}

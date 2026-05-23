import type { LLMRequest } from "../../schema"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Convert a single top-level option key from camelCase to snake_case. Values
// are left verbatim — recursive conversion would mangle structured payloads
// (IDs, nested provider-shaped objects) and provider APIs do not require it.
// PascalCase (`FooBar`) becomes `foo_bar` without a leading underscore.
export const snakeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()

// Merge provider option namespaces using AI SDK precedence semantics: later
// sources override earlier ones, missing namespaces are skipped. Used by every
// native protocol that reads request-level provider options.
export const merge = (request: LLMRequest, keys: ReadonlyArray<string>) => {
  const sources = keys.map((key) => request.providerOptions?.[key]).filter(isRecord)
  return Object.assign({}, ...sources) as Record<string, unknown>
}

// Spread the unknown remainder of a merged option bag onto a provider body.
// `consumed` lists keys already lowered explicitly so they aren't duplicated
// or echoed at the wrong shape.
export const passthrough = (options: Record<string, unknown>, consumed: ReadonlySet<string>) => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    if (consumed.has(key)) continue
    if (value === undefined) continue
    result[snakeKey(key)] = value
  }
  return result
}

export * as ProviderOptions from "./provider-options"

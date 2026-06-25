export * as ProviderOverlay from "./provider-overlay"

export function merge(
  base: Readonly<Record<string, unknown>> | undefined,
  overlay: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (base === undefined) return overlay && { ...overlay }
  if (overlay === undefined) return { ...base }
  return Object.fromEntries(
    new Set([...Object.keys(base), ...Object.keys(overlay)]).values().map((key) => {
      const left = base[key]
      const right = overlay[key]
      if (right === undefined) return [key, left]
      if (plain(left) && plain(right)) return [key, merge(left, right)]
      return [key, right]
    }),
  )
}

export function headers(
  base: Readonly<Record<string, string>> | undefined,
  overlay: Readonly<Record<string, string>> | undefined,
) {
  return Object.fromEntries(
    [...Object.entries(base ?? {}), ...Object.entries(overlay ?? {})]
      .reduce((result, entry) => {
        result.set(entry[0].toLowerCase(), entry)
        return result
      }, new Map<string, [string, string]>())
      .values(),
  )
}

function plain(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

export * as ProviderOverlay from "./provider-overlay"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const mergeRecords = (...items: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>) => {
  const result: Record<string, unknown> = {}
  for (const item of items) {
    for (const [key, value] of Object.entries(item ?? {})) {
      result[key] = isRecord(result[key]) && isRecord(value) ? mergeRecords(result[key], value) : value
    }
  }
  return result
}

export const mergeHeaders = (...items: ReadonlyArray<Readonly<Record<string, string>> | undefined>) => {
  const result = new Map<string, readonly [string, string]>()
  for (const item of items) {
    for (const entry of Object.entries(item ?? {})) result.set(entry[0].toLowerCase(), entry)
  }
  return Object.fromEntries(result.values())
}

export const assign = (
  target: { headers: Record<string, string>; body: Record<string, unknown> },
  overlay: { readonly headers?: Readonly<Record<string, string>>; readonly body?: Readonly<Record<string, unknown>> },
) => {
  const headers = mergeHeaders(target.headers, overlay.headers)
  Object.keys(target.headers).forEach((key) => delete target.headers[key])
  Object.assign(target.headers, headers)
  const body = mergeRecords(target.body, overlay.body)
  Object.keys(target.body).forEach((key) => delete target.body[key])
  Object.assign(target.body, body)
}

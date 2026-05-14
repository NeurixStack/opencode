import { Context, Effect, Layer, Ref, Schema, Stream } from "effect"
import { FastCheck } from "effect/testing"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

type UrlMatcher = string | RegExp | ((request: RequestInfo) => boolean)

export interface Matcher {
  readonly method?: string | readonly string[]
  readonly url: UrlMatcher
}

export type RequestBody =
  | { readonly type: "empty" }
  | { readonly type: "text"; readonly text: string; readonly json?: unknown }
  | { readonly type: "bytes"; readonly bytes: Uint8Array }
  | { readonly type: "form"; readonly form: FormData }
  | { readonly type: "unknown"; readonly value: unknown }

export interface RequestInfo {
  readonly method: string
  readonly url: URL
  readonly headers: Readonly<Record<string, string>>
  readonly body: RequestBody
}

export type ResponseEntry =
  | {
      readonly kind: "jsonSchema"
      readonly matcher: Matcher
      readonly status?: number
      readonly headers?: Readonly<Record<string, string>>
      readonly schema: Schema.Codec<unknown, unknown, unknown, never>
      readonly seed?: number | ((request: RequestInfo) => number)
    }
  | {
      readonly kind: "json"
      readonly matcher: Matcher
      readonly status?: number
      readonly headers?: Readonly<Record<string, string>>
      readonly body: unknown | ((request: RequestInfo) => unknown)
    }
  | {
      readonly kind: "text"
      readonly matcher: Matcher
      readonly status?: number
      readonly headers?: Readonly<Record<string, string>>
      readonly body: string | ((request: RequestInfo) => string)
    }
  | {
      readonly kind: "bytes"
      readonly matcher: Matcher
      readonly status?: number
      readonly headers?: Readonly<Record<string, string>>
      readonly body: Uint8Array | ((request: RequestInfo) => Uint8Array)
    }
  | {
      readonly kind: "handler"
      readonly matcher: Matcher
      readonly handle: (request: RequestInfo) => Response | Promise<Response> | Effect.Effect<Response, SimulationNetworkError>
    }
  | {
      readonly kind: "status"
      readonly matcher: Matcher
      readonly status: number
      readonly headers?: Readonly<Record<string, string>>
    }

export interface Options {
  readonly entries?: readonly ResponseEntry[]
  readonly allowLoopback?: boolean
}

interface State {
  readonly initialEntries: readonly ResponseEntry[]
  readonly entries: readonly ResponseEntry[]
  readonly allowLoopback: boolean
}

export interface Snapshot {
  readonly allowLoopback: boolean
  readonly routes: ReadonlyArray<{
    readonly kind: ResponseEntry["kind"]
    readonly matcher: string
    readonly method?: string | readonly string[]
  }>
}

export class SimulationNetworkError extends Schema.TaggedErrorClass<SimulationNetworkError>()(
  "SimulationNetworkError",
  {
    method: Schema.String,
    url: Schema.String,
    reason: Schema.String,
  },
) {}

export interface Interface {
  readonly register: (entry: ResponseEntry) => Effect.Effect<void>
  readonly reset: () => Effect.Effect<void>
  readonly snapshot: () => Effect.Effect<Snapshot>
  readonly handle: (request: RequestInfo) => Effect.Effect<Response, SimulationNetworkError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SimulationNetwork") {}

function normalizeMatcher(matcher: Matcher | UrlMatcher): Matcher {
  if (typeof matcher === "object" && !(matcher instanceof RegExp) && "url" in matcher) return matcher
  return { url: matcher }
}

function matchesUrl(matcher: UrlMatcher, request: RequestInfo) {
  if (typeof matcher === "string") return request.url.toString() === matcher
  if (matcher instanceof RegExp) return matcher.test(request.url.toString())
  return matcher(request)
}

function matches(matcher: Matcher, request: RequestInfo) {
  const methods = matcher.method === undefined ? [] : Array.isArray(matcher.method) ? matcher.method : [matcher.method]
  if (methods.length > 0 && !methods.some((method) => method.toUpperCase() === request.method.toUpperCase())) return false
  return matchesUrl(matcher.url, request)
}

function matcherLabel(matcher: Matcher) {
  if (typeof matcher.url === "string") return matcher.url
  if (matcher.url instanceof RegExp) return matcher.url.source
  return "<predicate>"
}

function isLoopback(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
}

function headers(input: Readonly<Record<string, string>> | undefined, contentType?: string) {
  return new Headers({ ...(contentType ? { "content-type": contentType } : {}), ...input })
}

function seedFromRequest(request: RequestInfo) {
  return [...`${request.method} ${request.url}`].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 1)
}

function generated(schema: Schema.Codec<unknown, unknown, unknown, never>, seed: number) {
  const sample = FastCheck.sample(Schema.toArbitrary(schema), { seed, numRuns: 1 })[0]
  return Schema.encodeUnknownSync(schema)(sample)
}

function response(entry: ResponseEntry, request: RequestInfo) {
  switch (entry.kind) {
    case "jsonSchema":
      return new Response(
        JSON.stringify(generated(entry.schema, typeof entry.seed === "function" ? entry.seed(request) : (entry.seed ?? seedFromRequest(request)))),
        {
          status: entry.status ?? 200,
          headers: headers(entry.headers, "application/json"),
        },
      )
    case "json":
      return new Response(JSON.stringify(typeof entry.body === "function" ? entry.body(request) : entry.body), {
        status: entry.status ?? 200,
        headers: headers(entry.headers, "application/json"),
      })
    case "text":
      return new Response(typeof entry.body === "function" ? entry.body(request) : entry.body, {
        status: entry.status ?? 200,
        headers: headers(entry.headers, "text/plain"),
      })
    case "bytes":
      return new Response((typeof entry.body === "function" ? entry.body(request) : entry.body).slice().buffer, {
        status: entry.status ?? 200,
        headers: headers(entry.headers, "application/octet-stream"),
      })
    case "handler":
      return entry.handle(request)
    case "status":
      return new Response(null, { status: entry.status, headers: headers(entry.headers) })
  }
}

function responseEffect(entry: ResponseEntry, request: RequestInfo): Effect.Effect<Response, SimulationNetworkError> {
  const result = response(entry, request)
  if (Effect.isEffect(result)) return result
  if (result instanceof Promise) return Effect.promise(() => result)
  return Effect.succeed(result)
}

function parseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function asBytes(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === "string") return new TextEncoder().encode(value)
  return undefined
}

function requestBody(body: Parameters<typeof HttpClientResponse.fromWeb>[0]["body"]) {
  switch (body._tag) {
    case "Empty":
      return Effect.succeed({ type: "empty" } satisfies RequestBody)
    case "Raw": {
      const bytes = asBytes(body.body)
      if (!bytes) return Effect.succeed({ type: "unknown", value: body.body } satisfies RequestBody)
      const text = new TextDecoder().decode(bytes)
      return Effect.succeed({ type: "text", text, json: parseJson(text) } satisfies RequestBody)
    }
    case "Uint8Array": {
      const text = new TextDecoder().decode(body.body)
      if (body.contentType.includes("json") || body.contentType.startsWith("text/")) {
        return Effect.succeed({ type: "text", text, json: parseJson(text) } satisfies RequestBody)
      }
      return Effect.succeed({ type: "bytes", bytes: body.body } satisfies RequestBody)
    }
    case "FormData":
      return Effect.succeed({ type: "form", form: body.formData } satisfies RequestBody)
    case "Stream":
      return Stream.runCollect(body.stream).pipe(
        Effect.map((chunks) => {
          const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          const text = new TextDecoder().decode(bytes)
          if (body.contentType.includes("json") || body.contentType.startsWith("text/")) {
            return { type: "text", text, json: parseJson(text) } satisfies RequestBody
          }
          return { type: "bytes", bytes } satisfies RequestBody
        }),
        Effect.catch(() => Effect.succeed({ type: "unknown", value: body } satisfies RequestBody)),
      )
  }
}

function toRequestInfo(
  method: string,
  url: URL,
  headers: Readonly<Record<string, string>>,
  body: RequestBody,
): RequestInfo {
  return { method, url, headers, body }
}

function toHttpClientError(request: Parameters<typeof HttpClientResponse.fromWeb>[0], error: SimulationNetworkError) {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `${error.reason}: ${error.url}`,
    }),
  })
}

export function make(options: Options = {}) {
  return Effect.gen(function* () {
    const state = yield* Ref.make<State>({
      initialEntries: options.entries ?? [],
      entries: options.entries ?? [],
      allowLoopback: options.allowLoopback ?? true,
    })

    const register = Effect.fn("SimulationNetwork.register")(function* (entry: ResponseEntry) {
      yield* Ref.update(state, (current) => ({ ...current, entries: [...current.entries, entry] }))
    })

    const reset = Effect.fn("SimulationNetwork.reset")(function* () {
      yield* Ref.update(state, (current) => ({ ...current, entries: current.initialEntries }))
    })

    const snapshot = Effect.fn("SimulationNetwork.snapshot")(function* () {
      const current = yield* Ref.get(state)
      return {
        allowLoopback: current.allowLoopback,
        routes: current.entries.map((entry) => ({
          kind: entry.kind,
          matcher: matcherLabel(entry.matcher),
          ...(entry.matcher.method === undefined ? {} : { method: entry.matcher.method }),
        })),
      } satisfies Snapshot
    })

    const handle = Effect.fn("SimulationNetwork.handle")(function* (request: RequestInfo) {
      const current = yield* Ref.get(state)
      const entry = current.entries.find((entry) => matches(entry.matcher, request))
      if (entry) return yield* responseEffect(entry, request)
      if (current.allowLoopback && isLoopback(request.url)) {
        return yield* Effect.promise(() => fetch(request.url, { method: request.method, headers: request.headers }))
      }
      return yield* new SimulationNetworkError({
        method: request.method,
        url: request.url.toString(),
        reason: "No simulated network response registered",
      })
    })

    return Service.of({ register, reset, snapshot, handle })
  })
}

export const serviceLayer = (options?: Options) => Layer.effect(Service, make(options))

export const httpClientLayer = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const network = yield* Service
    return HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const body = yield* requestBody(request.body)
        const response = yield* network
          .handle(toRequestInfo(request.method, url, request.headers, body))
          .pipe(Effect.mapError((error) => toHttpClientError(request, error)))
        return HttpClientResponse.fromWeb(request, response)
      }),
    )
  }),
)

export const layer = (options?: Options) => {
  const service = serviceLayer(options)
  return Layer.mergeAll(service, httpClientLayer.pipe(Layer.provide(service)))
}

export const denyUnknownLayer = layer({ allowLoopback: true })

export const text = (
  matcher: Matcher | UrlMatcher,
  body: string | ((request: RequestInfo) => string),
  options?: { status?: number; headers?: Record<string, string> },
) =>
  ({ kind: "text", matcher: normalizeMatcher(matcher), body, ...options }) satisfies ResponseEntry

export const json = (
  matcher: Matcher | UrlMatcher,
  body: unknown | ((request: RequestInfo) => unknown),
  options?: { status?: number; headers?: Record<string, string> },
) =>
  ({ kind: "json", matcher: normalizeMatcher(matcher), body, ...options }) satisfies ResponseEntry

export const jsonSchema = (
  matcher: Matcher | UrlMatcher,
  schema: Schema.Codec<unknown, unknown, unknown, never>,
  options?: { status?: number; headers?: Record<string, string>; seed?: number | ((request: RequestInfo) => number) },
) => ({ kind: "jsonSchema", matcher: normalizeMatcher(matcher), schema, ...options }) satisfies ResponseEntry

export const bytes = (
  matcher: Matcher | UrlMatcher,
  body: Uint8Array | ((request: RequestInfo) => Uint8Array),
  options?: { status?: number; headers?: Record<string, string> },
) => ({ kind: "bytes", matcher: normalizeMatcher(matcher), body, ...options }) satisfies ResponseEntry

export const handler = (
  matcher: Matcher | UrlMatcher,
  handle: (request: RequestInfo) => Response | Promise<Response> | Effect.Effect<Response, SimulationNetworkError>,
) => ({ kind: "handler", matcher: normalizeMatcher(matcher), handle }) satisfies ResponseEntry

export const status = (matcher: Matcher | UrlMatcher, code: number, options?: { headers?: Record<string, string> }) =>
  ({ kind: "status", matcher: normalizeMatcher(matcher), status: code, ...options }) satisfies ResponseEntry

export * as SimulationNetwork from "./network"

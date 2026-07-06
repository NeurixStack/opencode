export * as SearchFirecrawl from "./firecrawl"

import { define } from "@opencode-ai/plugin/v2/effect"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { collectBoundedResponseBody } from "../../tool/http-body"
import { SearchMcp } from "./mcp"

export const endpoint = "https://api.firecrawl.dev/v2/search"

const Request = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
})

const WebResult = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  markdown: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
  category: Schema.optional(Schema.String),
})
const NewsResult = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
  snippet: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  markdown: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
})
const ImageResult = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
  imageUrl: Schema.String,
  imageWidth: Schema.optional(Schema.Number),
  imageHeight: Schema.optional(Schema.Number),
  position: Schema.optional(Schema.Number),
})
const Response = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    web: Schema.optional(Schema.Array(WebResult)),
    news: Schema.optional(Schema.Array(NewsResult)),
    images: Schema.optional(Schema.Array(ImageResult)),
  }),
  warning: Schema.optional(Schema.NullOr(Schema.String)),
  id: Schema.optional(Schema.String),
  creditsUsed: Schema.optional(Schema.Number),
})
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))
const decodeResponse = Schema.decodeUnknownEffect(Response)

const format = (response: typeof Response.Type) =>
  [
    ...(response.data.web ?? []).map((result) =>
      [`## ${result.title ?? result.url}`, `URL: ${result.url}`, result.description, result.markdown || undefined]
        .filter((line) => line !== undefined)
        .join("\n\n"),
    ),
    ...(response.data.news ?? []).map((result) =>
      [
        `## ${result.title ?? result.url}`,
        `URL: ${result.url}`,
        result.date ? `Date: ${result.date}` : undefined,
        result.snippet,
        result.markdown || undefined,
      ]
        .filter((line) => line !== undefined)
        .join("\n\n"),
    ),
    ...(response.data.images ?? []).map((result) =>
      [`## ${result.title ?? result.url}`, `Source: ${result.url}`, `Image: ${result.imageUrl}`].join("\n\n"),
    ),
  ].join("\n\n")

const search = (
  http: HttpClient.HttpClient,
  input: { readonly query: string; readonly numResults?: number; readonly contextMaxCharacters?: number },
  apiKey?: string,
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders({
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      }),
      HttpClientRequest.schemaBodyJson(Request)({ query: input.query, limit: input.numResults }),
    )
    const response = yield* HttpClient.filterStatusOk(http).execute(request)
    const body = yield* collectBoundedResponseBody(
      response,
      SearchMcp.MAX_RESPONSE_BYTES,
      () => new Error(`Firecrawl response exceeded ${SearchMcp.MAX_RESPONSE_BYTES} bytes`),
    )
    const metadata = yield* decodeJson(body.toString("utf8"))
    const result = yield* decodeResponse(metadata)
    const text = format(result)
    return {
      text: input.contextMaxCharacters ? text.slice(0, input.contextMaxCharacters) : text,
      metadata,
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(25),
      orElse: () => Effect.fail(new Error("Firecrawl search request timed out")),
    }),
  )

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.search.firecrawl",
  effect: Effect.fn("SearchFirecrawl.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      draft.update("firecrawl", (integration) => (integration.name = "Firecrawl"))
      draft.method.update({ integrationID: "firecrawl", method: { type: "key", label: "API key (optional)" } })
      draft.method.update({ integrationID: "firecrawl", method: { type: "env", names: ["FIRECRAWL_API_KEY"] } })
      draft.capability.search.update({
        integrationID: "firecrawl",
        capability: { type: "search", connection: "optional" },
        execute: (input, context) =>
          search(http, input, context.credential?.type === "key" ? context.credential.key : undefined),
      })
    })
  }),
})

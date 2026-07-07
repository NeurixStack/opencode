import { Location } from "@opencode-ai/schema/location"
import { Search } from "@opencode-ai/schema/search"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const SearchGroup = HttpApiGroup.make("server.search")
  .add(
    HttpApiEndpoint.post("search.query", "/api/search", {
      query: LocationQuery,
      payload: Schema.Struct(Search.Input.fields),
      success: Location.response(Search.Result),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.search.query",
          summary: "Search the web",
          description:
            "Run one web search through the selected integration. Specify a provider to override the configured default.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "search",
      description: "Location-scoped web search routes.",
    }),
  )

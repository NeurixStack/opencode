import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Search } from "@opencode-ai/schema/search"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const SearchGroup = HttpApiGroup.make("server.search")
  .add(
    HttpApiEndpoint.get("search.provider.get", "/api/search/provider", {
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Integration.ID)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.search.provider.get",
          summary: "Get default search provider",
          description: "Return the globally selected web search provider.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("search.provider.select", "/api/search/provider", {
      query: LocationQuery,
      payload: Schema.Struct({ providerID: Integration.ID }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.search.provider.select",
          summary: "Select default search provider",
          description: "Persist the global web search provider in the user configuration.",
        }),
      ),
  )
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

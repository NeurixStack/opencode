export * as WebSearch from "./websearch.js"

import { Schema } from "effect"
import { IntegrationID } from "./integration-id.js"
import { optional } from "./schema.js"

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  query: Schema.String,
  providerID: IntegrationID.pipe(optional),
}).annotate({ identifier: "WebSearch.Input" })

export interface ProviderOutput extends Schema.Schema.Type<typeof ProviderOutput> {}
export const ProviderOutput = Schema.Struct({
  text: Schema.String,
  metadata: Schema.Json.pipe(optional),
}).annotate({ identifier: "WebSearch.ProviderOutput" })

export class Result extends Schema.Class<Result>("WebSearch.Result")({
  providerID: IntegrationID,
  ...ProviderOutput.fields,
}) {}

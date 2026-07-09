import type { WebSearch } from "@opencode-ai/schema/websearch"
import type { Registration } from "./registration.js"

export interface WebSearchDefinition {
  readonly id: string
  readonly name: string
  readonly execute: (
    input: Pick<WebSearch.Input, "query">,
    context: { readonly sessionID?: string; readonly signal: AbortSignal },
  ) => Promise<WebSearch.ProviderOutput>
}

export interface WebSearchDomain {
  readonly register: (definition: WebSearchDefinition) => Promise<Registration>
}

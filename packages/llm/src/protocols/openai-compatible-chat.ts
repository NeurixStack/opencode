import { Effect, Schema } from "effect"
import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import type { LLMRequest } from "../schema"
import { ProviderOptions } from "./utils/provider-options"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = RouteRoutedModelInput

const OpenAICompatibleChatBody = Schema.StructWithRest(
  Schema.Struct({ ...OpenAIChat.bodyFields, reasoning_effort: Schema.optional(Schema.String) }),
  [Schema.Record(Schema.String, Schema.Any)],
)
export type OpenAICompatibleChatBody = Schema.Schema.Type<typeof OpenAICompatibleChatBody>

// Typed AI SDK `@ai-sdk/openai-compatible` options. Known keys are lowered
// explicitly; everything else passes through to the wire body with its
// top-level key snake-cased.
interface CompatibleOptions {
  readonly user?: string
  readonly reasoningEffort?: string
  readonly textVerbosity?: string
  readonly strictJsonSchema?: boolean
  readonly [extra: string]: unknown
}
const COMPATIBLE_KNOWN_KEYS: ReadonlySet<string> = new Set([
  "user",
  "reasoningEffort",
  "textVerbosity",
  "strictJsonSchema",
])

// Match AI SDK `@ai-sdk/openai-compatible` option resolution: the deprecated
// `openai-compatible` alias, the canonical `openaiCompatible` key, the raw
// provider name (dot-split so e.g. `opencode.internal` matches `opencode`),
// and its camelCase variant. Later sources override earlier ones.
const bodyOptions = (request: LLMRequest) => {
  const provider = String(request.model.provider).split(".")[0]
  const camel = provider.replace(/[_-]([a-z])/g, (_, value: string) => value.toUpperCase())
  const options = ProviderOptions.merge(request, [
    "openai-compatible",
    "openaiCompatible",
    provider,
    camel,
  ]) as CompatibleOptions
  return {
    ...ProviderOptions.passthrough(options, COMPATIBLE_KNOWN_KEYS),
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.reasoningEffort !== undefined ? { reasoning_effort: options.reasoningEffort } : {}),
    ...(options.textVerbosity !== undefined ? { verbosity: options.textVerbosity } : {}),
  }
}

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAICompatibleChatBody,
    // Drop providerOptions before delegating so OpenAI Chat's OpenAI-only
    // option validation does not reject compatible-route requests whose
    // provider id happens to be `openai` or use extended reasoning efforts.
    from: (request) =>
      OpenAIChat.protocol.body
        .from({ ...request, providerOptions: undefined })
        .pipe(Effect.map((body) => ({ ...body, ...bodyOptions(request) }))),
  },
  stream: OpenAIChat.protocol.stream,
})

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses OpenAI Chat streaming behavior while
 * allowing compatible providers to pass through additional request-body
 * options such as `enable_thinking` and extended reasoning efforts.
 */
export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"

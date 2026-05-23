import { Schema } from "effect"
import type { LLMRequest } from "../../schema"
import { ReasoningEfforts, TextVerbosity, type ReasoningEffort } from "../../schema"
import { ProviderOptions } from "./provider-options"

export const OpenAIReasoningEfforts = ReasoningEfforts.filter(
  (effort): effort is Exclude<ReasoningEffort, "max"> => effort !== "max",
)
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEfforts)[number]

const OPENAI_REASONING_EFFORTS = new Set<string>(OpenAIReasoningEfforts)

export const OpenAIReasoningEffort = Schema.Literals(OpenAIReasoningEfforts)
export const OpenAITextVerbosity = TextVerbosity

export const isReasoningEffort = (effort: unknown): effort is OpenAIReasoningEffort =>
  typeof effort === "string" && OPENAI_REASONING_EFFORTS.has(effort)

// Typed AI SDK OpenAI options. Mirrors the camelCase surface AI SDK accepts.
// Known keys are typed; everything else passes through to the wire body with
// its top-level key snake-cased.
export interface Options {
  readonly store?: boolean
  readonly promptCacheKey?: string
  readonly promptCacheRetention?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningSummary?: string
  readonly textVerbosity?: "low" | "medium" | "high"
  readonly include?: ReadonlyArray<string>
  readonly includeEncryptedReasoning?: boolean
  readonly instructions?: string
  readonly conversation?: string
  readonly maxToolCalls?: number
  readonly metadata?: Record<string, unknown>
  readonly parallelToolCalls?: boolean
  readonly previousResponseId?: string
  readonly safetyIdentifier?: string
  readonly serviceTier?: string
  readonly logprobs?: boolean | number
  readonly truncation?: string
  readonly user?: string
  readonly [extra: string]: unknown
}

export const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "store",
  "promptCacheKey",
  "promptCacheRetention",
  "reasoningEffort",
  "reasoningSummary",
  "textVerbosity",
  "include",
  "includeEncryptedReasoning",
  "instructions",
  "conversation",
  "maxToolCalls",
  "metadata",
  "parallelToolCalls",
  "previousResponseId",
  "safetyIdentifier",
  "serviceTier",
  "logprobs",
  "truncation",
  "user",
])

// Read the merged `openai` provider option bag. Producers
// (`packages/opencode/src/provider/transform.ts`) emit typed values; we widen
// only the index signature so passthrough keys remain reachable. Invalid
// shapes surface in the lowerer where they're consumed, not at decode time.
export const options = (request: LLMRequest): Options => ProviderOptions.merge(request, ["openai"]) as Options

export * as OpenAIOptions from "./openai-options"

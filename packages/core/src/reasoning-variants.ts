export * as ReasoningVariants from "./reasoning-variants"

import type { ModelsDev } from "./models-dev"

const OPENAI_INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]

export function generate(npm: string | undefined, options: ReadonlyArray<ModelsDev.ReasoningOption> | undefined) {
  const effort = options?.find((option) => option.type === "effort")
  if (effort?.type === "effort") {
    return Object.fromEntries(
      effort.values.flatMap((value) => {
        const raw: unknown = value
        const id = raw === null ? "none" : typeof raw === "string" ? raw : undefined
        if (id === undefined) return []
        const settings = settingsForEffort(npm, id)
        return settings ? [[id, settings] as const] : []
      }),
    )
  }

  const budget = options?.find((option) => option.type === "budget_tokens")
  if (budget?.type !== "budget_tokens") return {}
  const max = budget.max
  const high = max === undefined ? Math.max(budget.min ?? 0, 16_000) : Math.min(Math.max(budget.min ?? 0, 16_000), max)
  return Object.fromEntries(
    [{ id: "high", budget: high }, ...(max === undefined || max === high ? [] : [{ id: "max", budget: max }])].flatMap(
      (item) => {
        const settings = settingsForBudget(npm, item.budget)
        return settings ? [[item.id, settings] as const] : []
      },
    ),
  )
}

function settingsForEffort(npm: string | undefined, effort: string) {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { effort } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return { thinking: { type: "adaptive", display: "summarized" }, effort }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
  }
  if (npm === "@ai-sdk/azure") return { reasoningEffort: effort }
  if (npm === "@ai-sdk/openai") {
    return {
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: OPENAI_INCLUDE_ENCRYPTED_REASONING,
    }
  }
  if (npm === "@ai-sdk/openai-compatible") return { reasoningEffort: effort }
}

function settingsForBudget(npm: string | undefined, budget: number) {
  if (npm === "@openrouter/ai-sdk-provider") return { reasoning: { max_tokens: budget } }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    return { thinking: { type: "enabled", budgetTokens: budget } }
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") {
    return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
  }
}

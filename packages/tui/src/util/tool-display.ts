import type { IntegrationInfo } from "@opencode-ai/sdk/v2"

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function selectedWebSearchProvider(integrations: readonly Pick<IntegrationInfo, "id" | "capabilities">[]) {
  return integrations.find((integration) =>
    integration.capabilities.some((capability) => capability.type === "search" && capability.selected),
  )?.id
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "pending") return {}
  if (!("structured" in state) || !state.structured || typeof state.structured !== "object") return {}
  if (Array.isArray(state.structured)) return {}
  return state.structured as Record<string, unknown>
}

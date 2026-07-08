import { Context } from "effect"
import type { Span } from "effect/Tracer"

export const CurrentModelSpan = Context.Reference<Span | undefined>("@opencode/LLM/Telemetry/CurrentModelSpan", {
  defaultValue: () => undefined,
})

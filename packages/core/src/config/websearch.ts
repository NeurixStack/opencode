export * as ConfigWebSearch from "./websearch"

import { Integration } from "@opencode-ai/schema/integration"
import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Integration.ID,
}) {}

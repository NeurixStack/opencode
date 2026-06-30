export * as McpCommandPlugin from "./mcp-command"

import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Effect, Stream } from "effect"
import { EventV2 } from "../event"
import { MCP } from "../mcp"
import { define } from "./internal"

export const Plugin = define({
  id: "mcp-command",
  effect: Effect.fn(function* (ctx) {
    const mcp = yield* MCP.Service
    const events = yield* EventV2.Service
    yield* ctx.command.transform(
      Effect.fn(function* (draft) {
        for (const prompt of yield* mcp.prompts()) {
          draft.update(commandName(prompt), (command) => {
            command.template = ""
            command.description = prompt.description
          })
        }
      }),
    )
    yield* events
      .subscribe(McpEvent.PromptsChanged)
      .pipe(Stream.runForEach(() => ctx.command.reload()), Effect.forkScoped({ startImmediately: true }))
  }),
})

const commandName = (prompt: MCP.Prompt) => `${sanitize(prompt.server)}:${sanitize(prompt.name)}`

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

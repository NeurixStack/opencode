export * as MCPCommandPlugin from "./mcp-command"

import { Effect } from "effect"
import { MCP } from "../mcp"
import { define } from "./internal"

export const Plugin = define({
  id: "mcp-command",
  effect: Effect.fn(function* (ctx) {
    const mcp = yield* MCP.Service
    yield* Effect.gen(function* () {
      const prompts = yield* mcp.prompts()
      const commands = yield* Effect.forEach(
        prompts,
        (prompt) =>
          mcp
            .prompt({
              server: prompt.server,
              name: prompt.name,
              args: Object.fromEntries(prompt.arguments?.map((argument, index) => [argument.name, `$${index + 1}`]) ?? []),
            })
            .pipe(
              Effect.map((result) => ({
                name: `${sanitize(prompt.server)}:${sanitize(prompt.name)}`,
                description: prompt.description,
                template: promptText(result),
              })),
            ),
        { concurrency: "unbounded" },
      )
      yield* ctx.command.transform((draft) => {
        for (const command of commands) {
          const template = command.template
          if (!template || draft.get(command.name)) continue
          draft.update(command.name, (item) => {
            item.template = template
            item.source = "mcp"
            if (command.description !== undefined) item.description = command.description
          })
        }
      })
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("failed to register MCP prompt commands", {
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )
  }),
})

function promptText(result: MCP.PromptResult | undefined) {
  const text = result?.messages
    .flatMap((message) => {
      const content = message.content
      if (!content || typeof content !== "object") return []
      if (!("type" in content) || content.type !== "text") return []
      if (!("text" in content) || typeof content.text !== "string") return []
      return [content.text]
    })
    .join("\n")
    .trim()
  return text || undefined
}

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

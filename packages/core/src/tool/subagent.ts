export * as SubagentTool from "./subagent"

import { ToolFailure } from "@opencode-ai/llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { makeLocationNode, type LocationNode } from "../effect/app-node"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const name = "subagent"

const NO_TEXT = "Subagent completed without a text response."
const BACKGROUND_STARTED =
  "The subagent is working in the background. You will be notified automatically when it finishes. DO NOT sleep, poll, or proactively check on its progress."

export const Input = Schema.Struct({
  agent: Schema.String.annotate({ description: "The configured agent to run as the subagent" }),
  description: Schema.String.annotate({ description: "A short description of the subagent's task" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  model: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional model override in 'providerID/modelID' form; defaults to the agent or session model",
  }),
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT poll its progress.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})

export const description = [
  "Spawn a subagent: a child session running a configured agent with fresh context.",
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

// Accept "providerID/modelID" overrides; anything malformed falls back to the agent/session default.
const parseModel = (value: string | undefined): ModelV2.Ref | undefined => {
  if (value === undefined || !value.includes("/")) return undefined
  const parsed = ModelV2.parse(value)
  return ModelV2.Ref.make({ providerID: parsed.providerID, id: parsed.modelID })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const sessions = yield* SessionV2.Service
    const jobs = yield* BackgroundJob.Service
    const agents = yield* AgentV2.Service
    const events = yield* EventV2.Service

    // Concatenate the child's final completed assistant text. Distinguishes "completed with no
    // text" (generic string) from "failed" (the run effect fails, surfaced as a job error).
    const latestAssistantText = Effect.fn("SubagentTool.latestAssistantText")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const messages = yield* sessions.messages({ sessionID, order: "desc", limit: 20 })
      const assistant = messages.find(
        (message) => message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
      )
      if (assistant === undefined || assistant.type !== "assistant") return NO_TEXT
      const text = assistant.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("")
      return text.length > 0 ? text : NO_TEXT
    })

    const injectCompletion = Effect.fn("SubagentTool.injectCompletion")(function* (
      parentID: SessionSchema.ID,
      childID: SessionSchema.ID,
      description: string,
      text: string,
    ) {
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: parentID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text: `<subagent id="${childID}" state="completed" description="${description}">\n${text}\n</subagent>`,
      })
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined)
                return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })

              // Precedence: explicit input model -> agent's configured model -> parent session model.
              const model = parseModel(input.model) ?? agent.model

              const child = yield* sessions.create({
                parentID: context.sessionID,
                title: input.description,
                agent: AgentV2.ID.make(input.agent),
                model,
                // No location: the child inherits the parent's location.
                // TODO(opencode kkdvxn): derive restricted subagent permissions from the parent
                // session (V1 deriveSubagentSessionPermission). MVP uses the agent's own permissions.
              })

              const background = input.background === true

              const run = Effect.gen(function* () {
                // The child session owns its agent/model (set at create); prompt only admits input.
                yield* sessions.prompt({ sessionID: child.id, prompt: { text: input.prompt } })
                yield* sessions.wait(child.id)
                return yield* latestAssistantText(child.id)
              })

              const info = yield* jobs.start({
                id: child.id,
                type: name,
                title: input.description,
                metadata: background ? { background: true } : {},
                onPromote: jobs
                  .wait({ id: child.id })
                  .pipe(
                    Effect.flatMap((result) =>
                      result.info?.status === "completed"
                        ? injectCompletion(context.sessionID, child.id, input.description, result.info.output ?? NO_TEXT)
                        : Effect.void,
                    ),
                  ),
                run,
              })

              if (background) {
                return { sessionID: child.id, status: "running" as const, output: BACKGROUND_STARTED }
              }

              const result = yield* Effect.raceFirst(
                jobs.wait({ id: child.id }).pipe(Effect.map((waited) => waited.info)),
                jobs.waitForPromotion(child.id),
              )
              if (result?.metadata?.background === true)
                return { sessionID: child.id, status: "running" as const, output: BACKGROUND_STARTED }
              if (result?.status === "error")
                return yield* new ToolFailure({ message: result.error ?? "Subagent failed" })
              if (result?.status === "cancelled")
                return yield* new ToolFailure({ message: "Subagent cancelled" })
              return { sessionID: child.id, status: "completed" as const, output: result?.output ?? NO_TEXT }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

// Registered as a separate Location-scoped node rather than inside builtins, because its session
// dependencies would form a static import cycle through location-services -> tool/builtins -> session.
// Explicit annotation keeps SessionV2's type (which references LocationServiceMap) from
// expanding into the locationServices group inference and forming a type-level self-reference.
export const node: LocationNode<never> = makeLocationNode({
  name: "subagent-tool",
  layer,
  deps: [ToolRegistry.toolsNode, SessionV2.node, AgentV2.node, BackgroundJob.node, EventV2.node],
})

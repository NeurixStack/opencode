import { expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTitle } from "@opencode-ai/core/session/title"
import { SessionV2 } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
let resolvedModels: Array<{ id: string; provider: string } | undefined> = []
let failSmallResolve = false
const model = Model.make({
  id: "title-model",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
})
const client = Layer.mock(LLMClient.Service)({
  prepare: () => Effect.die("unused"),
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(LLMEvent.textDelta({ id: "title", text: "Generated Title\n" }))
  },
  generate: () => Effect.die("unused"),
})
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: (session) => {
    resolvedModels.push(session.model ? { id: session.model.id, provider: session.model.providerID } : undefined)
    if (failSmallResolve && session.model?.id === "mini") {
      return Effect.fail(new Error("small unavailable") as never)
    }
    const selected = session.model
      ? Model.make({
          id: session.model.id,
          provider: session.model.providerID,
          route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
        })
      : model
    return Effect.succeed(SessionRunnerModel.resolved(selected))
  },
  resolveCatalogModel: (session, selected) => {
    resolvedModels.push({ id: selected.id, provider: selected.providerID })
    if (failSmallResolve && selected.id === ModelV2.ID.make("mini")) {
      return Effect.fail(new Error("small unavailable") as never)
    }
    return Effect.succeed(
      SessionRunnerModel.resolved(
        Model.make({
          id: selected.id,
          provider: selected.providerID,
          route: OpenAIChat.route.with({ limits: { context: 10_000, output: 1_000 } }),
        }),
      ),
    )
  },
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      AgentV2.node,
      Catalog.node,
      SessionTitle.node,
    ]),
    [
      [llmClient, client],
      [SessionRunnerModel.node, models],
    ],
  ),
)

const insertSession = (
  id: SessionV2.ID,
  model?: { id: string; providerID: string },
) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "New session - fake",
        version: "test",
        ...(model
          ? {
              model: {
                id: ModelV2.ID.make(model.id),
                providerID: ProviderV2.ID.make(model.providerID),
              },
            }
          : {}),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const prompt = (sessionID: SessionV2.ID, text: string) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const messageID = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.InputAdmitted, {
      sessionID,
      inputID: messageID,
      input: { type: "user", data: { text }, delivery: "steer" },
    })
    yield* events.publish(SessionEvent.InputPromoted, {
      sessionID,
      inputID: messageID,
    })
  })

const enableTitleAgent = (model?: { id: string; providerID: string }) =>
  Effect.gen(function* () {
    const agentService = yield* AgentV2.Service
    yield* agentService.transform((editor) => {
      editor.update(AgentV2.ID.make("title"), (agent) => {
        agent.mode = "primary"
        agent.hidden = true
        agent.system = "You are a title generator."
        if (model) {
          agent.model = {
            id: ModelV2.ID.make(model.id),
            providerID: ProviderV2.ID.make(model.providerID),
          }
        }
      })
    })
  })

const seedSmallModel = () =>
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const providerID = ProviderV2.ID.make("test")
    yield* catalog.transform((catalog) => {
      catalog.provider.update(providerID, () => {})
      catalog.model.update(providerID, ModelV2.ID.make("main"), (model) => {
        model.time.released = Date.now()
      })
      catalog.model.update(providerID, ModelV2.ID.make("mini"), (model) => {
        model.enabled = false
        model.family = ModelV2.Family.make("gpt-nano")
        model.time.released = Date.now()
      })
      catalog.model.small.set(providerID, ModelV2.ID.make("mini"))
    })
  })

it.effect("generates a title from the sole user message and renames the session", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    yield* enableTitleAgent()
    const sessionID = SessionV2.ID.make("ses_title_generate")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain("Help me debug the failing build")
    const renamed = yield* store.get(sessionID)
    expect(renamed?.title).toBe("Generated Title")
  }),
)

it.effect("prefers the catalog small model over the session model", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    yield* enableTitleAgent()
    yield* seedSmallModel()
    const sessionID = SessionV2.ID.make("ses_title_small_model")
    yield* insertSession(sessionID, { id: "main", providerID: "test" })
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(resolvedModels).toEqual([{ id: "mini", provider: "test" }])
    expect(String(requests[0]?.model.id)).toBe("mini")
  }),
)

it.effect("prefers the title agent model over the catalog small model", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    yield* enableTitleAgent({ id: "agent-title", providerID: "test" })
    yield* seedSmallModel()
    const sessionID = SessionV2.ID.make("ses_title_agent_model")
    yield* insertSession(sessionID, { id: "main", providerID: "test" })
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(resolvedModels).toEqual([{ id: "agent-title", provider: "test" }])
    expect(String(requests[0]?.model.id)).toBe("agent-title")
  }),
)

it.effect("falls back to the session model when no small model exists", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    failSmallResolve = false
    yield* enableTitleAgent()
    const sessionID = SessionV2.ID.make("ses_title_session_fallback")
    yield* insertSession(sessionID, { id: "main", providerID: "test" })
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(resolvedModels).toEqual([{ id: "main", provider: "test" }])
    expect(String(requests[0]?.model.id)).toBe("main")
  }),
)

it.effect("falls back to the session model when small model resolution fails", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    failSmallResolve = true
    yield* enableTitleAgent()
    yield* seedSmallModel()
    const sessionID = SessionV2.ID.make("ses_title_small_resolve_fail")
    yield* insertSession(sessionID, { id: "main", providerID: "test" })
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(resolvedModels).toEqual([
      { id: "mini", provider: "test" },
      { id: "main", provider: "test" },
    ])
    expect(String(requests[0]?.model.id)).toBe("main")
  }),
)

it.effect("uses the catalog default provider when the session has no model", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    failSmallResolve = false
    yield* enableTitleAgent()
    yield* seedSmallModel()
    const catalog = yield* Catalog.Service
    yield* catalog.transform((catalog) => {
      catalog.model.default.set(ProviderV2.ID.make("test"), ModelV2.ID.make("main"))
    })
    const sessionID = SessionV2.ID.make("ses_title_default_provider")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(resolvedModels).toEqual([{ id: "mini", provider: "test" }])
    expect(String(requests[0]?.model.id)).toBe("mini")
  }),
)

it.effect("does not generate once a second user message exists", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    yield* enableTitleAgent()
    const sessionID = SessionV2.ID.make("ses_title_second_message")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "First message")
    yield* prompt(sessionID, "Second message")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(requests).toHaveLength(0)
    const untouched = yield* store.get(sessionID)
    expect(untouched?.title).toBe("New session - fake")
  }),
)

it.effect("does not generate for a child session", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    yield* enableTitleAgent()
    const sessionID = SessionV2.ID.make("ses_title_child")
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        parent_id: SessionV2.ID.make("ses_title_parent"),
        slug: sessionID,
        directory: "/project",
        title: "Child session - fake",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* prompt(sessionID, "Do this subtask")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(requests).toHaveLength(0)
  }),
)

it.effect("does not generate when the title agent is removed", () =>
  Effect.gen(function* () {
    requests = []
    resolvedModels = []
    const sessionID = SessionV2.ID.make("ses_title_no_agent")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const session = yield* store
      .get(sessionID)
      .pipe(Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("session missing"))))
    const title = yield* SessionTitle.Service
    yield* title.generateForFirstPrompt(session)

    expect(requests).toHaveLength(0)
    const untouched = yield* store.get(sessionID)
    expect(untouched?.title).toBe("New session - fake")
  }),
)

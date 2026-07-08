import { beforeEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Scope } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { ConfigGlobal } from "@opencode-ai/core/config/global"
import { ConfigWebSearch } from "@opencode-ai/core/config/websearch"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Form } from "@opencode-ai/core/form"
import { Global } from "@opencode-ai/core/global"
import { Integration } from "@opencode-ai/core/integration"
import { WebSearch } from "@opencode-ai/core/websearch"
import { testEffect } from "./lib/effect"

let entries: Config.Entry[] = []
const writes: { path: readonly (string | number)[]; value: unknown }[] = []
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(entries) }))
const configGlobal = Layer.succeed(
  ConfigGlobal.Service,
  ConfigGlobal.Service.of({ update: (path, value) => Effect.sync(() => writes.push({ path, value })) }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([WebSearch.node, Integration.node, Credential.node, EventV2.node, Form.node, ConfigGlobal.node]),
    [
      [Config.node, config],
      [ConfigGlobal.node, configGlobal],
    ],
  ),
)

const register = (id: string, connection: "optional" | "required" = "optional") =>
  Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const integrationID = Integration.ID.make(id)
    const calls: { input: WebSearch.Input; credential?: Credential.Value; sessionID?: string }[] = []
    yield* integrations.transform((draft) => {
      draft.update(integrationID, (integration) => (integration.name = id.toUpperCase()))
      draft.websearch.update({
        integrationID,
        connection,
        execute: (input, context) =>
          Effect.sync(() => {
            calls.push({ input, ...context })
            return { text: `${id}: ${input.query}`, metadata: { id } }
          }),
      })
    })
    return { integrationID, calls }
  })

beforeEach(() => {
  entries = []
  writes.length = 0
})

describe("WebSearch", () => {
  it.effect("executes an explicit provider without changing the default", () =>
    Effect.gen(function* () {
      const provider = yield* register("exa")
      const websearch = yield* WebSearch.Service

      expect(yield* websearch.query({ query: "effect", providerID: provider.integrationID })).toEqual(
        new WebSearch.Result({
          providerID: provider.integrationID,
          text: "exa: effect",
          metadata: { id: "exa" },
        }),
      )
      expect(yield* websearch.selected()).toBeUndefined()
      expect(provider.calls).toEqual([
        {
          input: { query: "effect", providerID: provider.integrationID },
          credential: undefined,
          sessionID: undefined,
        },
      ])
    }),
  )

  it.effect("uses and persists the global provider selection", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.select(parallel.integrationID)

      expect((yield* websearch.query({ query: "layers" })).providerID).toBe(parallel.integrationID)
      expect(yield* websearch.selected()).toBe(parallel.integrationID)
      expect(writes).toEqual([
        { path: ["websearch"], value: new ConfigWebSearch.Info({ provider: parallel.integrationID }) },
      ])
    }),
  )

  it.effect("reads the selected provider from global config", () =>
    Effect.gen(function* () {
      const provider = yield* register("exa")
      const websearch = yield* WebSearch.Service
      entries = [
        new Config.Document({
          type: "document",
          path: path.join(Global.Path.config, "opencode.json"),
          info: new Config.Info({ websearch: new ConfigWebSearch.Info({ provider: provider.integrationID }) }),
        }),
      ]

      expect(yield* websearch.selected()).toBe(provider.integrationID)
      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(provider.integrationID)
    }),
  )

  it.effect("prefers the location config over the global selection", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.select(exa.integrationID)
      entries = [
        new Config.Document({
          type: "document",
          info: new Config.Info({ websearch: new ConfigWebSearch.Info({ provider: parallel.integrationID }) }),
        }),
      ]

      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(parallel.integrationID)
    }),
  )

  it.effect("serializes concurrent first-use onboarding and persists the answer", () =>
    Effect.gen(function* () {
      const provider = yield* register("exa")
      const websearch = yield* WebSearch.Service
      const forms = yield* Form.Service
      const first = yield* websearch.query({ query: "one", sessionID: "ses_websearch" }).pipe(Effect.forkChild)
      const second = yield* websearch.query({ query: "two", sessionID: "ses_websearch" }).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      const pending = yield* forms.list({ sessionID: "ses_websearch" })
      expect(pending).toHaveLength(1)
      const form = pending[0]
      if (!form) return yield* Effect.die("Expected an onboarding form")
      yield* forms.reply({ id: form.id, answer: { provider: provider.integrationID } })

      expect((yield* Fiber.join(first)).providerID).toBe(provider.integrationID)
      expect((yield* Fiber.join(second)).providerID).toBe(provider.integrationID)
      expect(yield* websearch.selected()).toBe(provider.integrationID)
    }),
  )

  it.effect("requires a connection before invoking a required provider", () =>
    Effect.gen(function* () {
      const provider = yield* register("private", "required")
      const websearch = yield* WebSearch.Service

      expect(
        yield* websearch.query({ query: "secret", providerID: provider.integrationID }).pipe(Effect.flip),
      ).toBeInstanceOf(WebSearch.ConnectionRequiredError)
      expect(provider.calls).toEqual([])
    }),
  )

  it.effect("removes scoped provider registrations", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const provider = yield* register("temporary").pipe(Scope.provide(scope))
      expect(yield* integrations.websearch.get(provider.integrationID)).toBeDefined()
      yield* Scope.close(scope, Exit.void)
      expect(yield* integrations.websearch.get(provider.integrationID)).toBeUndefined()
    }),
  )
})

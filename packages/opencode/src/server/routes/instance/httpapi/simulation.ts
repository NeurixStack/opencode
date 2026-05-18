import { Simulation } from "@/testing/simulation/service"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

const ok = { ok: true }

function json<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.map((result) => HttpServerResponse.jsonUnsafe(result)),
    Effect.catch((error) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: String(error) }, { status: 400 }))),
  )
}

export const simulationRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const simulation = yield* Simulation.Service

    yield* router.add("POST", "/experimental/simulation/reset", () =>
      json(simulation.reset().pipe(Effect.as(ok))),
    )

    yield* router.add("POST", "/experimental/simulation/filesystem/seed", () =>
      json(
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Simulation.FilesystemSeedInput)
          return yield* simulation.seedFilesystem(input)
        }),
      ),
    )

    yield* router.add("POST", "/experimental/simulation/filesystem/write", () =>
      json(
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Simulation.FilesystemWriteInput)
          return yield* simulation.writeFile(input)
        }),
      ),
    )

    yield* router.add("POST", "/experimental/simulation/network/register", () =>
      json(
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Simulation.NetworkRegisterInput)
          return yield* simulation.registerNetwork(input)
        }),
      ),
    )

    yield* router.add("POST", "/experimental/simulation/llm/enqueue", () =>
      json(
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Simulation.LLMEnqueueInput)
          return yield* simulation.enqueueLLM(input)
        }),
      ),
    )

    yield* router.add("GET", "/experimental/simulation/snapshot", () => json(simulation.snapshot()))

    yield* router.add("GET", "/experimental/simulation/log/entries", () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ entries: Log.entries() })),
    )

    yield* router.add("POST", "/experimental/simulation/log/clear", () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(((): { cleared: true } => {
          Log.clearEntries()
          return { cleared: true }
        })()),
      ),
    )
  }),
)

export * as SimulationHttpRoute from "./simulation"

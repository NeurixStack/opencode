import { Simulation } from "@/testing/simulation/service"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

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

    yield* router.add("POST", "/experimental/simulation/network/register", () =>
      json(
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Simulation.NetworkRegisterInput)
          return yield* simulation.registerNetwork(input)
        }),
      ),
    )

    yield* router.add("POST", "/experimental/simulation/llm/enqueue", () =>
      json(Effect.succeed({ ok: false, skipped: "mock provider scripts are not implemented yet" })),
    )

    yield* router.add("GET", "/experimental/simulation/snapshot", () => json(simulation.snapshot()))
  }),
)

export * as SimulationHttpRoute from "./simulation"

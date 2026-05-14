import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { SimulationFileSystem } from "../../../src/testing/simulation/filesystem"
import { SimulationNetwork } from "../../../src/testing/simulation/network"
import { Simulation } from "../../../src/testing/simulation/service"
import { testEffect } from "../../lib/effect"

const fsLayer = SimulationFileSystem.layer({ root: "/opencode" })
const networkLayer = SimulationNetwork.layer({ allowLoopback: false })
const simulationLayer = Simulation.layer.pipe(Layer.provide(fsLayer), Layer.provide(networkLayer))
const it = testEffect(Layer.mergeAll(fsLayer, networkLayer, simulationLayer))

describe("Simulation", () => {
  it.effect("seeds files into the simulated filesystem", () =>
    Effect.gen(function* () {
      const simulation = yield* Simulation.Service
      const fs = yield* AppFileSystem.Service

      expect(yield* simulation.seedFilesystem({ files: { "opencode.json": "{}" } })).toEqual({
        files: ["opencode.json"],
      })
      expect(yield* fs.readFileString("/opencode/opencode.json")).toBe("{}")
    }),
  )

  it.effect("registers network responses through control state", () =>
    Effect.gen(function* () {
      const simulation = yield* Simulation.Service
      const http = yield* HttpClient.HttpClient

      expect(
        yield* simulation.registerNetwork({
          kind: "json",
          method: "GET",
          url: "https://example.com/data",
          body: { ok: true },
        }),
      ).toEqual({ registered: "https://example.com/data" })

      const response = yield* http.execute(HttpClientRequest.get("https://example.com/data"))
      expect(yield* response.json).toEqual({ ok: true })
    }),
  )

  it.effect("snapshots and resets simulation state", () =>
    Effect.gen(function* () {
      const simulation = yield* Simulation.Service
      const http = yield* HttpClient.HttpClient

      yield* simulation.seedFilesystem({ files: { "README.md": "hello" } })
      yield* simulation.registerNetwork({ kind: "text", url: "https://example.com/page", body: "hello" })

      const snapshot = yield* simulation.snapshot()
      expect(snapshot.files).toEqual(["README.md"])
      expect(snapshot.networkRegistrations).toEqual(["* https://example.com/page"])
      expect(snapshot.network.routes.some((route) => route.matcher === "https://example.com/page")).toBe(true)

      yield* simulation.reset()

      expect((yield* simulation.snapshot()).files).toEqual([])
      const exit = yield* http.execute(HttpClientRequest.get("https://example.com/page")).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})

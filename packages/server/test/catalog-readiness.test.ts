import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createEmbeddedRoutes } from "../src/routes"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe("catalog readiness", () => {
  test("catalog reads wait for initial plugin activation", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-catalog-"))
    directories.push(directory)
    await fs.writeFile(
      path.join(directory, "opencode.json"),
      JSON.stringify({
        plugins: ["-*", path.join(import.meta.dir, "fixtures/delayed-catalog-plugin.ts")],
      }),
    )

    const server = HttpRouter.toWebHandler(createEmbeddedRoutes().pipe(Layer.provide(HttpServer.layerServices)))
    const request = (pathname: string) =>
      server.handler(
        new Request(`http://localhost${pathname}`, {
          headers: { "x-opencode-directory": directory },
        }),
      )

    try {
      const [providers, models] = await Promise.all([request("/api/provider"), request("/api/model")])
      expect(providers.status).toBe(200)
      expect(models.status).toBe(200)
      const initialProviders = (await providers.json()).data
      const initialModels = (await models.json()).data

      expect((await request("/api/model/default")).status).toBe(200)
      const [readyProviders, readyModels] = await Promise.all([request("/api/provider"), request("/api/model")])
      expect((await readyProviders.json()).data).toContainEqual(expect.objectContaining({ id: "delayed-provider" }))
      expect((await readyModels.json()).data).toContainEqual(
        expect.objectContaining({ providerID: "delayed-provider", id: "delayed-model" }),
      )

      expect(initialProviders).toContainEqual(expect.objectContaining({ id: "delayed-provider" }))
      expect(initialModels).toContainEqual(
        expect.objectContaining({ providerID: "delayed-provider", id: "delayed-model" }),
      )
    } finally {
      await server.dispose()
    }
  })
})

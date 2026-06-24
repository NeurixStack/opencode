import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import Http from "node:http"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Config, Context, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpPaths } from "../../src/server/routes/instance/httpapi/groups/mcp"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)

const it = testEffect(
  servedRoutes.pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer)),
)

const callbackPath = McpPaths.authCallback.replace(":name", "secure-oauth")
const authPath = McpPaths.auth.replace(":name", "secure-oauth")

function listenOAuthServer(tokenCalls: { value: number }) {
  return Effect.gen(function* () {
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    const origin = HttpServer.formatAddress(server.address)
    yield* server.serve(
      HttpServerRequest.HttpServerRequest.use((request) => {
        const url = new URL(request.url, origin)
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
          return HttpServerResponse.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
          })
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return HttpServerResponse.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
          })
        if (url.pathname === "/token")
          return Effect.gen(function* () {
            yield* request.text
            tokenCalls.value++
            return yield* HttpServerResponse.json({ access_token: "access-token", token_type: "Bearer" })
          })
        if (url.pathname !== "/mcp") return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
        if (request.headers.authorization !== "Bearer access-token")
          return Effect.succeed(
            HttpServerResponse.empty({
              status: 401,
              headers: {
                "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
              },
            }),
          )
        return Effect.gen(function* () {
          const body = yield* request.json
          if (
            typeof body === "object" &&
            body !== null &&
            "method" in body &&
            body.method === "notifications/initialized"
          )
            return HttpServerResponse.empty({ status: 202 })
          if (typeof body === "object" && body !== null && "method" in body && body.method === "tools/list")
            return yield* HttpServerResponse.json({
              jsonrpc: "2.0",
              id: "id" in body ? body.id : null,
              result: { tools: [] },
            })
          return yield* HttpServerResponse.json({
            jsonrpc: "2.0",
            id: typeof body === "object" && body !== null && "id" in body ? body.id : null,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "oauth-test", version: "1.0.0" },
            },
          })
        })
      }),
    )
    return origin
  })
}

function availablePort() {
  return Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const server = Http.createServer()
        server.on("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          if (!address || typeof address === "string") return reject(new Error("Failed to allocate callback port"))
          server.close((error) => (error ? reject(error) : resolve(address.port)))
        })
      }),
  )
}

function assertPortAvailable(port: number) {
  return Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const server = Http.createServer()
        server.on("error", reject)
        server.listen(port, "127.0.0.1", () => server.close((error) => (error ? reject(error) : resolve())))
      }),
  )
}

function setup() {
  return Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const tokenCalls = { value: 0 }
    const upstream = yield* listenOAuthServer(tokenCalls)
    const callbackPort = yield* availablePort()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "opencode.json"),
        JSON.stringify({
          formatter: false,
          lsp: false,
          mcp: {
            "secure-oauth": {
              type: "remote",
              url: `${upstream}/mcp`,
              oauth: { clientId: "test-client", callbackPort },
            },
          },
        }),
      ),
    )
    return { directory, tokenCalls, callbackPort }
  })
}

function request(directory: string, route: string, payload?: object) {
  const base = HttpClientRequest.post(route).pipe(HttpClientRequest.setHeader("x-opencode-directory", directory))
  if (!payload) return HttpClient.execute(base)
  return base.pipe(HttpClientRequest.bodyJson(payload), Effect.flatMap(HttpClient.execute))
}

describe("mcp HttpApi OAuth", () => {
  it.live("requires, validates, consumes, and rejects replayed callback state", () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const started = yield* request(test.directory, authPath)
      expect(started.status).toBe(200)
      const first = (yield* started.json) as { oauthState: string }

      const missing = yield* request(test.directory, callbackPath, { code: "missing-state" })
      expect(missing.status).toBe(400)
      expect(test.tokenCalls.value).toBe(0)

      const wrong = yield* request(test.directory, callbackPath, { code: "wrong-state", state: "wrong" })
      expect(wrong.status).toBe(400)
      expect(test.tokenCalls.value).toBe(0)

      const restarted = yield* request(test.directory, authPath)
      expect(restarted.status).toBe(200)
      const second = (yield* restarted.json) as { oauthState: string }
      expect(second.oauthState).not.toBe(first.oauthState)

      const correct = yield* request(test.directory, callbackPath, { code: "valid-code", state: second.oauthState })
      expect(correct.status).toBe(200)
      expect(test.tokenCalls.value).toBe(1)

      const replayed = yield* request(test.directory, callbackPath, { code: "replayed-code", state: second.oauthState })
      expect(replayed.status).toBe(400)
      expect(test.tokenCalls.value).toBe(1)
    }),
  )

  it.live("does not bind the browser callback listener during manual start", () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const started = yield* request(test.directory, authPath)
      expect(started.status).toBe(200)
      expect(McpOAuthCallback.isRunning()).toBe(false)
      yield* assertPortAvailable(test.callbackPort)
    }),
  )
})

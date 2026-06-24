import { describe, expect, test } from "bun:test"
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
// @ts-expect-error Bun's query cache key avoids process-global module mocks from other test files.
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js?oauth-header-isolation"

const canary = "resource-secret"
const staticAuthorization = "Bearer static-resource-token"
const basicAuthorization = `Basic ${btoa("client:secret")}`

describe("MCP OAuth header isolation", () => {
  test("keeps resource headers on same-origin protected resource metadata", async () => {
    using authorizationServer = serve(() =>
      Response.json({
        issuer: authorizationServer.origin,
        authorization_endpoint: `${authorizationServer.origin}/authorize`,
        token_endpoint: `${authorizationServer.origin}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      }),
    )
    using resource = serve((request) => {
      if (new URL(request.url).pathname === "/prm") {
        return Response.json({
          resource: `${resource.origin}/mcp`,
          authorization_servers: [authorizationServer.origin],
        })
      }
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource.origin}/prm"` },
      })
    })
    const transport = new StreamableHTTPClientTransport(new URL(`${resource.origin}/mcp`), {
      authProvider: createProvider({
        clientInformation: { client_id: "client", token_endpoint_auth_method: "none" },
      }),
      requestInit: { headers: { "X-Resource-Canary": canary, Authorization: staticAuthorization } },
    })

    await transport.start()
    await expect(transport.send(request())).rejects.toThrow("Unauthorized")
    await transport.close()

    expect(resource.requests.map((request) => new URL(request.url).pathname)).toEqual(["/mcp", "/prm"])
    expectResourceHeaders(resource.requests)
    expectNoResourceHeaders(authorizationServer.requests)
  })

  test("does not follow protected resource metadata redirects with resource headers", async () => {
    using target = serve(() => Response.json({}))
    using resource = serve((request) => {
      if (new URL(request.url).pathname === "/prm") {
        return Response.redirect(`${target.origin}/prm`)
      }
      return new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource.origin}/prm"` },
      })
    })
    const transport = new StreamableHTTPClientTransport(new URL(`${resource.origin}/mcp`), {
      authProvider: createProvider({
        clientInformation: { client_id: "client", token_endpoint_auth_method: "none" },
      }),
      requestInit: { headers: { "X-Resource-Canary": canary } },
    })

    await transport.start()
    await expect(transport.send(request())).rejects.toThrow("Unauthorized")
    await transport.close()

    expect(target.requests).toHaveLength(0)
  })

  test("keeps resource headers out of discovery, registration, and token exchange", async () => {
    using token = serve(() => Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "refresh" }))
    using registration = serve(() =>
      Response.json({
        client_id: "client",
        client_secret: "secret",
        token_endpoint_auth_method: "client_secret_basic",
        redirect_uris: ["http://127.0.0.1/callback"],
        client_name: "OpenCode test",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    )
    using authorizationServer = serve(() =>
      Response.json({
        issuer: authorizationServer.origin,
        authorization_endpoint: `${authorizationServer.origin}/authorize`,
        token_endpoint: `${token.origin}/token`,
        registration_endpoint: `${registration.origin}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }),
    )
    using metadata = serve(() =>
      Response.json({
        resource: `${resource.origin}/mcp`,
        authorization_servers: [authorizationServer.origin],
      }),
    )
    using resource = serve(
      () =>
        new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata.origin}/prm"` },
        }),
    )
    const provider = createProvider()
    const transport = new StreamableHTTPClientTransport(new URL(`${resource.origin}/mcp`), {
      authProvider: provider,
      requestInit: { headers: { "X-Resource-Canary": canary, aUtHoRiZaTiOn: staticAuthorization } },
    })

    await transport.start()
    await expect(transport.send(request())).rejects.toThrow("Unauthorized")
    await transport.finishAuth("authorization-code")
    await transport.close()

    expectResourceHeaders(resource.requests)
    expectNoResourceHeaders(metadata.requests)
    expectNoResourceHeaders(authorizationServer.requests)
    expectNoResourceHeaders(registration.requests)
    expectNoResourceHeaders(token.requests)
    expect(registration.requests).toHaveLength(1)
    expect(token.requests).toHaveLength(1)
    expectAuthorization(token.requests[0], basicAuthorization)
    expect(new URLSearchParams(token.requests[0].body).get("grant_type")).toBe("authorization_code")
  })

  test("keeps resource headers out of token refresh", async () => {
    using refresh = serve(() => Response.json({ access_token: "fresh-access", token_type: "Bearer" }))
    using authorizationServer = serve(() =>
      Response.json({
        issuer: authorizationServer.origin,
        authorization_endpoint: `${authorizationServer.origin}/authorize`,
        token_endpoint: `${refresh.origin}/refresh`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }),
    )
    using metadata = serve(() =>
      Response.json({
        resource: `${resource.origin}/mcp`,
        authorization_servers: [authorizationServer.origin],
      }),
    )
    using resource = serve((request) => {
      if (resource.requests.length === 1) {
        return new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata.origin}/prm"` },
        })
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} })
    })
    const transport = new StreamableHTTPClientTransport(new URL(`${resource.origin}/mcp`), {
      authProvider: createProvider({
        clientInformation: {
          client_id: "client",
          client_secret: "secret",
          token_endpoint_auth_method: "client_secret_basic",
        },
        tokens: { access_token: "expired-access", token_type: "Bearer", refresh_token: "refresh-token" },
      }),
      requestInit: { headers: { "X-Resource-Canary": canary, authorization: staticAuthorization } },
    })
    transport.onmessage = () => {}

    await transport.start()
    await transport.send(request())
    await transport.close()

    expect(resource.requests).toHaveLength(2)
    expectResourceHeaders(resource.requests, ["Bearer expired-access", "Bearer fresh-access"])
    expectNoResourceHeaders(metadata.requests)
    expectNoResourceHeaders(authorizationServer.requests)
    expectNoResourceHeaders(refresh.requests)
    expect(refresh.requests).toHaveLength(1)
    expectAuthorization(refresh.requests[0], basicAuthorization)
    expect(new URLSearchParams(refresh.requests[0].body).get("grant_type")).toBe("refresh_token")
  })
})

function createProvider(initial?: {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
}): OAuthClientProvider {
  let clientInformation = initial?.clientInformation
  let tokens = initial?.tokens
  let codeVerifier = ""
  return {
    redirectUrl: "http://127.0.0.1/callback",
    clientMetadata: {
      redirect_uris: ["http://127.0.0.1/callback"],
      client_name: "OpenCode test",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    } satisfies OAuthClientMetadata,
    clientInformation: () => clientInformation,
    saveClientInformation: (value) => {
      clientInformation = value
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value
    },
    redirectToAuthorization: () => {},
    saveCodeVerifier: (value) => {
      codeVerifier = value
    },
    codeVerifier: () => codeVerifier,
    state: () => "state",
  }
}

function request() {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencode-test", version: "1" },
    },
  }
}

function expectResourceHeaders(requests: CapturedRequest[], authorization: string | string[] = staticAuthorization) {
  expect(requests.length).toBeGreaterThan(0)
  for (const [index, request] of requests.entries()) {
    expect(request.headers.get("x-resource-canary")).toBe(canary)
    expectAuthorization(request, Array.isArray(authorization) ? authorization[index] : authorization)
  }
}

function expectNoResourceHeaders(requests: CapturedRequest[]) {
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) {
    expect(request.headers.get("x-resource-canary")).toBeNull()
    expect(request.headers.get("authorization")).not.toBe(staticAuthorization)
  }
}

function expectAuthorization(request: CapturedRequest, value: string) {
  expect([...request.headers].filter(([name]) => name === "authorization")).toEqual([["authorization", value]])
}

interface CapturedRequest {
  url: string
  headers: Headers
  body: string
}

function serve(handler: (request: CapturedRequest) => Response | Promise<Response>) {
  const requests: CapturedRequest[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const captured = {
        url: request.url,
        headers: new Headers(request.headers),
        body: await request.text(),
      }
      requests.push(captured)
      return handler(captured)
    },
  })
  return {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    [Symbol.dispose]: () => server.stop(true),
  }
}

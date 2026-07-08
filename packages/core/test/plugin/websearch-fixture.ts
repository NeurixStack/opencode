import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "../lib/effect"

export interface WebSearchRequest {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

export const requests: WebSearchRequest[] = []
export const response = { body: "" }

export function resetWebSearchFixture(body: string) {
  requests.length = 0
  response.body = body
}

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
      requests.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(new TextDecoder().decode(request.body.body)),
      })
      return HttpClientResponse.fromWeb(request, new Response(response.body, { status: 200 }))
    }),
  ),
)

export const webSearchIntegrationTest = testEffect(
  Layer.merge(AppNodeBuilder.build(LayerNode.group([Integration.node, Credential.node, EventV2.node])), http),
)

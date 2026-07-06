import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { SearchFirecrawl } from "@opencode-ai/core/plugin/search/firecrawl"
import { host, integrationHost } from "./host"
import { requests, resetSearchFixture, searchIntegrationTest } from "./search-fixture"

const metadata = {
  success: true,
  data: {
    web: [
      {
        url: "https://effect.website/",
        title: "Effect",
        description: "Build production TypeScript applications.",
        position: 1,
      },
    ],
  },
  id: "search_1",
  creditsUsed: 2,
}

beforeEach(() => {
  resetSearchFixture(JSON.stringify(metadata))
})

const it = searchIntegrationTest

describe("Firecrawl search integration", () => {
  it.effect("registers Firecrawl and uses its keyless default response", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* SearchFirecrawl.Plugin.effect(host({ integration: integrationHost(integrations) }))
      const provider = yield* integrations.capability.search.get(Integration.ID.make("firecrawl"))
      if (!provider) return yield* Effect.die("Expected Firecrawl search provider")

      const output = yield* provider.execute({ query: "effect", numResults: 3 }, {})
      expect(output).toEqual({
        text: "## Effect\n\nURL: https://effect.website/\n\nBuild production TypeScript applications.",
        metadata,
      })
      expect(requests).toEqual([
        {
          url: SearchFirecrawl.endpoint,
          headers: expect.not.objectContaining({ authorization: expect.anything() }),
          body: { query: "effect", limit: 3 },
        },
      ])
    }),
  )

  it.effect("sends a configured Firecrawl key as a bearer credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* SearchFirecrawl.Plugin.effect(host({ integration: integrationHost(integrations) }))
      const provider = yield* integrations.capability.search.get(Integration.ID.make("firecrawl"))
      if (!provider) return yield* Effect.die("Expected Firecrawl search provider")

      const output = yield* provider.execute(
        { query: "effect" },
        { credential: Credential.Key.make({ type: "key", key: "firecrawl-secret" }) },
      )
      expect(requests[0]?.headers).toMatchObject({ authorization: "Bearer firecrawl-secret" })
      expect(JSON.stringify(output)).not.toContain("firecrawl-secret")
    }),
  )
})

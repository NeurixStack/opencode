import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../lib/cli-process"

describe("opencode mcp", () => {
  cliIt.live(
    "adds MCP servers from inline arguments",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "github",
          "https://api.githubcopilot.com/mcp",
          "--type",
          "remote",
          "--header",
          "Authorization: Bearer test-token",
          "--global",
        ])
        opencode.expectExit(result, 0, "opencode mcp add remote")

        expect(yield* Effect.promise(() => Bun.file(path.join(home, ".config/opencode/opencode.json")).json())).toEqual(
          {
            mcp: {
              github: {
                type: "remote",
                url: "https://api.githubcopilot.com/mcp",
                headers: {
                  Authorization: "Bearer test-token",
                },
              },
            },
          },
        )

        const local = yield* opencode.spawn([
          "mcp",
          "add",
          "everything",
          "--env",
          "FOO=bar",
          "--global",
          "--",
          "npx",
          "-y",
          "@modelcontextprotocol/server-everything",
        ])
        opencode.expectExit(local, 0, "opencode mcp add local")

        expect(
          yield* Effect.promise(() => Bun.file(path.join(home, ".config/opencode/opencode.json")).json()),
        ).toMatchObject({
          mcp: {
            everything: {
              type: "local",
              command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
              environment: {
                FOO: "bar",
              },
            },
          },
        })

        const noOAuth = yield* opencode.spawn([
          "mcp",
          "add",
          "public",
          "https://example.com/mcp",
          "--no-oauth",
          "--global",
        ])
        opencode.expectExit(noOAuth, 0, "opencode mcp add no oauth")

        expect(
          yield* Effect.promise(() => Bun.file(path.join(home, ".config/opencode/opencode.json")).json()),
        ).toMatchObject({
          mcp: {
            public: {
              type: "remote",
              url: "https://example.com/mcp",
              oauth: false,
            },
          },
        })
      }),
    120_000,
  )
})

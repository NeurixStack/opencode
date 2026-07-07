import { describe, expect, test } from "bun:test"
import { materializeMcpResources } from "./mcp-resource"

describe("MCP resource prompt parts", () => {
  test("materializes text and blob content without retaining the resource source", async () => {
    const prompt = await materializeMcpResources(
      [
        {
          type: "file",
          path: "docs://readme",
          content: "@Readme",
          start: 0,
          end: 7,
          filename: "Readme",
          source: {
            type: "resource",
            clientName: "docs",
            uri: "docs://readme",
            text: { value: "@Readme", start: 0, end: 7 },
          },
        },
      ],
      async () => ({
        server: "docs",
        uri: "docs://readme",
        contents: [
          { type: "text", uri: "docs://readme", text: "hello", mimeType: "text/plain" },
          { type: "blob", uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" },
        ],
      }),
    )

    expect(prompt).toEqual([
      {
        type: "file",
        path: "docs://readme",
        content: "@Readme",
        start: 0,
        end: 7,
        mime: "text/plain",
        filename: "Readme",
        url: "data:text/plain;base64,aGVsbG8=",
      },
      {
        type: "file",
        path: "docs://logo",
        content: "",
        start: 0,
        end: 0,
        mime: "image/png",
        filename: "Readme-2",
        url: "data:image/png;base64,aGVsbG8=",
      },
    ])
  })

  test("fails when a resource is unavailable", async () => {
    await expect(
      materializeMcpResources(
        [
          {
            type: "file",
            path: "docs://missing",
            content: "@Missing",
            start: 0,
            end: 8,
            source: {
              type: "resource",
              clientName: "docs",
              uri: "docs://missing",
              text: { value: "@Missing", start: 0, end: 8 },
            },
          },
        ],
        async () => null,
      ),
    ).rejects.toThrow("Unable to read MCP resource: docs:docs://missing")
  })
})

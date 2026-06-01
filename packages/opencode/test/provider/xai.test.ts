import { describe, expect, test } from "bun:test"
import { createXai } from "@ai-sdk/xai"

describe("@ai-sdk/xai", () => {
  test("sends inline PDF attachments through the Responses API", async () => {
    let input: unknown
    const handle = async (_url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      input = JSON.parse(String(options?.body)).input
      return new Response(
        JSON.stringify({
          object: "response",
          output: [],
          status: "completed",
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    const xai = createXai({
      apiKey: "test",
      fetch: Object.assign(handle, { preconnect: fetch.preconnect.bind(fetch) }),
    })

    await xai.responses("grok-4").doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              filename: "sample.pdf",
              data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
            },
          ],
        },
      ],
    })

    expect(input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "sample.pdf",
            file_data: "data:application/pdf;base64,JVBERg==",
          },
        ],
      },
    ])
  })
})

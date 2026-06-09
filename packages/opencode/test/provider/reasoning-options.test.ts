import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"

const options = [
  { type: "toggle" },
  { type: "effort", values: [null, "low", "medium", "high", "xhigh", "max", "ultrathink"] },
  { type: "budget_tokens", min: 1024 },
  { type: "budget_tokens", min: 0, max: 24_576 },
]

describe("reasoning_options schemas", () => {
  test("models.dev model schema decodes all known option shapes", () => {
    const model = Schema.decodeUnknownSync(ModelsDev.Model)({
      id: "test-model",
      name: "Test Model",
      release_date: "2026-01-01",
      attachment: false,
      reasoning: true,
      reasoning_options: options,
      temperature: true,
      tool_call: true,
      limit: { context: 128000, output: 8192 },
    })
    expect(model.reasoning_options).toEqual(options as typeof model.reasoning_options)
  })

  test("config model schema decodes reasoning_options", () => {
    const model = Schema.decodeUnknownSync(ConfigProviderV1.Model)({ reasoning_options: options })
    expect(model.reasoning_options).toEqual(options as typeof model.reasoning_options)
  })

  test("provider capabilities decode reasoningOptions", () => {
    // The resolved catalog never carries null effort values; they are stripped
    // when mapping models.dev data, so the resolved schema rejects them.
    const resolved = [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "high", "xhigh", "max", "ultrathink"] },
      { type: "budget_tokens", min: 1024 },
      { type: "budget_tokens", min: 0, max: 24_576 },
    ]
    const capabilities = Schema.decodeUnknownSync(Provider.Model.fields.capabilities)({
      temperature: true,
      reasoning: true,
      reasoningOptions: resolved,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    })
    expect(capabilities.reasoningOptions).toEqual(resolved as typeof capabilities.reasoningOptions)
    expect(() =>
      Schema.decodeUnknownSync(Provider.Model.fields.capabilities)({
        temperature: true,
        reasoning: true,
        reasoningOptions: [{ type: "effort", values: [null, "low"] }],
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      }),
    ).toThrow()
  })
})

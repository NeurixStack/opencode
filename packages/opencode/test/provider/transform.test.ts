import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { LLMRequestPrep } from "@/session/llm/request"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { jsonSchema } from "ai"

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for openai provider by default", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({ model: openaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey for openai when explicitly disabled", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for the xAI SDK by default regardless of provider ID", () => {
    const xaiModel = {
      ...mockModel,
      providerID: "custom-xai",
      api: {
        id: "grok-4",
        url: "https://api.x.ai",
        npm: "@ai-sdk/xai",
      },
    }
    const result = ProviderTransform.options({ model: xaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey for the xAI SDK when explicitly disabled", () => {
    const xaiModel = {
      ...mockModel,
      providerID: "xai",
      api: {
        id: "grok-4",
        url: "https://api.x.ai",
        npm: "@ai-sdk/xai",
      },
    }
    const result = ProviderTransform.options({
      model: xaiModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set store=false for openai provider", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })

  test("should set store=false for azure provider by default", () => {
    const azureModel = {
      ...mockModel,
      providerID: "azure",
      api: {
        id: "gpt-4",
        url: "https://azure.com",
        npm: "@ai-sdk/azure",
      },
    }
    const result = ProviderTransform.options({
      model: azureModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })
})

describe("ProviderTransform.options - zai/zhipuai thinking", () => {
  const sessionID = "test-session-123"

  const createModel = (providerID: string) =>
    ({
      id: `${providerID}/glm-4.6`,
      providerID,
      api: {
        id: "glm-4.6",
        url: "https://open.bigmodel.cn/api/paas/v4",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM 4.6",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  for (const providerID of ["zai-coding-plan", "zai", "zhipuai-coding-plan", "zhipuai"]) {
    test(`${providerID} should set thinking cfg`, () => {
      const result = ProviderTransform.options({
        model: createModel(providerID),
        sessionID,
        providerOptions: {},
      })

      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })
  }
})

describe("ProviderTransform.options - minimax m3 thinking", () => {
  const createModel = (npm: string) =>
    ({
      id: "minimax/minimax-m3",
      providerID: "minimax",
      api: {
        id: "minimax-m3",
        url: "https://api.minimax.com",
        npm,
      },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
    }) as any

  test("explicitly enables adaptive thinking with the anthropic SDK", () => {
    expect(
      ProviderTransform.options({
        model: createModel("@ai-sdk/anthropic"),
        sessionID: "test-session-123",
      }).thinking,
    ).toEqual({ type: "adaptive" })
  })

  test("uses the native default with the openai-compatible SDK", () => {
    expect(
      ProviderTransform.options({
        model: createModel("@ai-sdk/openai-compatible"),
        sessionID: "test-session-123",
      }).thinking,
    ).toBeUndefined()
  })
})

describe("ProviderTransform.options - google thinkingConfig gating", () => {
  const sessionID = "test-session-123"

  const createGoogleModel = (reasoning: boolean, npm: "@ai-sdk/google" | "@ai-sdk/google-vertex") =>
    ({
      id: `${npm === "@ai-sdk/google" ? "google" : "google-vertex"}/gemini-2.0-flash`,
      providerID: npm === "@ai-sdk/google" ? "google" : "google-vertex",
      api: {
        id: "gemini-2.0-flash",
        url: npm === "@ai-sdk/google" ? "https://generativelanguage.googleapis.com" : "https://vertexai.googleapis.com",
        npm,
      },
      name: "Gemini 2.0 Flash",
      capabilities: {
        temperature: true,
        reasoning,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 1_000_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("does not set thinkingConfig for google models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })

  test("sets thinkingConfig for google models with reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(true, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toEqual({
      includeThoughts: true,
    })
  })

  test("does not set thinkingConfig for vertex models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google-vertex"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })
})

describe("ProviderTransform.options - gpt-5 textVerbosity", () => {
  const sessionID = "test-session-123"

  const createGpt5Model = (apiId: string) =>
    ({
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5.2 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.2")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
    expect(result.include).toEqual(["reasoning.encrypted_content"])
  })

  test("Bedrock Mantle gpt-5.5 uses OpenAI Responses defaults", () => {
    const model = {
      ...createGpt5Model("openai.gpt-5.5"),
      id: "amazon-bedrock/openai.gpt-5.5",
      providerID: "amazon-bedrock",
      api: {
        id: "openai.gpt-5.5",
        url: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
        npm: "@ai-sdk/amazon-bedrock/mantle",
      },
    }
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.store).toBe(false)
    expect(result.reasoningEffort).toBe("medium")
    expect(result.reasoningSummary).toBe("auto")
    expect(result.include).toEqual(["reasoning.encrypted_content"])
    expect(result.textVerbosity).toBe("low")
  })

  test("openai-compatible gpt-5 models omit Responses-only reasoningSummary", () => {
    const model = {
      ...createGpt5Model("gpt-5.4"),
      id: "cortecs/gpt-5.4",
      providerID: "cortecs",
      api: {
        id: "gpt-5.4",
        url: "https://api.cortecs.ai/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.reasoningEffort).toBe("medium")
    expect(result.reasoningSummary).toBeUndefined()
    expect(result.include).toBeUndefined()
  })

  test("azure chat completions omit Responses-only reasoning options after variants merge", async () => {
    const model = {
      ...createGpt5Model("gpt-5.4"),
      id: "azure/gpt-5.4",
      providerID: "azure",
      api: {
        id: "gpt-5.4",
        url: "https://azure.com",
        npm: "@ai-sdk/azure",
      },
      variants: {
        high: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    }
    const result = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: "msg_user-test",
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "azure", modelID: "gpt-5.4", variant: "high" },
        } as any,
        sessionID,
        model,
        agent: {
          name: "test",
          mode: "primary",
          options: {},
          permission: [],
        } as any,
        system: [],
        messages: [{ role: "user", content: "Hello" }],
        tools: {
          lookup: {
            description: "Look up a value",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
          },
        },
        provider: { id: "azure", options: { useCompletionUrls: true } } as any,
        auth: undefined,
        plugin: {
          trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        } as any,
        flags: { outputTokenMax: 32_000, client: "test" } as any,
        isWorkflow: false,
      }),
    )
    expect(result.params.options.reasoningEffort).toBe("high")
    expect(result.params.options.reasoningSummary).toBeUndefined()
    expect(result.params.options.include).toBeUndefined()
    expect(result.tools.lookup.strict).toBe(false)
  })

  test("gpt-5.1 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.1")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
  })

  test("gpt-5.2-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.2-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.1-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.1-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5.2-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-codex should NOT have textVerbosity set (codex models excluded)", () => {
    const model = createGpt5Model("gpt-5.2-codex")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })
})

describe("ProviderTransform.options - gpt-5 reasoningEffort", () => {
  const sessionID = "test-session-123"

  const createModel = (apiId: string) =>
    ({
      id: `azure/${apiId}`,
      providerID: "azure",
      api: {
        id: apiId,
        url: "https://azure.com",
        npm: "@ai-sdk/azure",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0.03,
        output: 0.06,
        cache: { read: 0.001, write: 0.002 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5-chat should NOT set reasoningEffort", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5-chat"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBeUndefined()
  })

  test("gpt-5.5 should NOT set reasoningEffort", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5.5"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBeUndefined()
  })
})

describe("ProviderTransform.options - gateway", () => {
  const sessionID = "test-session-123"

  const createModel = (id: string) =>
    ({
      id,
      providerID: "vercel",
      api: {
        id,
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
      name: id,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    }) as any

  test("puts gateway defaults under gateway key", () => {
    const model = createModel("anthropic/claude-sonnet-4")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result).toEqual({
      gateway: {
        caching: "auto",
      },
    })
  })
})

describe("ProviderTransform.providerOptions", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as any

  test("uses sdk key for non-gateway models", () => {
    const model = createModel({
      providerID: "my-bedrock",
      api: {
        id: "anthropic.claude-sonnet-4",
        url: "https://bedrock.aws",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

    expect(ProviderTransform.providerOptions(model, { cachePoint: { type: "default" } })).toEqual({
      bedrock: { cachePoint: { type: "default" } },
    })
  })

  test("forces reasoning for custom OpenAI package models with explicit effort", () => {
    const model = createModel({
      providerID: "meta",
      api: {
        id: "muse-spark",
        url: "https://api.ai.meta.com/v1",
        npm: "@ai-sdk/openai",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh", reasoningSummary: "auto" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh", reasoningSummary: "auto" },
    })
  })

  test("forces reasoning for OpenAI package models marked reasoning-capable", () => {
    expect(ProviderTransform.providerOptions(createModel(), { store: false })).toEqual({
      openai: { forceReasoning: true, store: false },
    })
  })

  test("forces reasoning for explicit effort even when model is not marked reasoning-capable", () => {
    const model = createModel({
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })

  test("forces reasoning for Azure OpenAI models with explicit effort", () => {
    const model = createModel({
      providerID: "azure",
      api: {
        id: "custom-gpt-5-deployment",
        url: "https://azure.openai.example.com/openai/v1",
        npm: "@ai-sdk/azure",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
      azure: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })

  test("forces reasoning for Bedrock Mantle OpenAI models with explicit effort", () => {
    const model = createModel({
      providerID: "amazon-bedrock",
      api: {
        id: "openai.gpt-5-custom",
        url: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
        npm: "@ai-sdk/amazon-bedrock/mantle",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })

  test("overrides forceReasoning false when reasoning should be forced", () => {
    expect(
      ProviderTransform.providerOptions(createModel(), { forceReasoning: false, reasoningEffort: "xhigh" }),
    ).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })

  test("uses gateway model provider slug for gateway models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("falls back to gateway key when gateway api id is unscoped", () => {
    const model = createModel({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      gateway: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("splits gateway routing options from provider-specific options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(
      ProviderTransform.providerOptions(model, {
        gateway: { order: ["vertex", "anthropic"] },
        thinking: { type: "enabled", budgetTokens: 12_000 },
      }),
    ).toEqual({
      gateway: { order: ["vertex", "anthropic"] },
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    } as any)
  })

  test("falls back to gateway key when model id has no provider slug", () => {
    const model = createModel({
      id: "claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "high" })).toEqual({
      gateway: { reasoningEffort: "high" },
    })
  })

  test("maps amazon slug to bedrock for provider options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "amazon/nova-2-lite",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningConfig: { type: "enabled" } })).toEqual({
      bedrock: { reasoningConfig: { type: "enabled" } },
    })
  })

  test("maps Bedrock Mantle provider options to OpenAI namespace", () => {
    const model = createModel({
      providerID: "amazon-bedrock",
      api: {
        id: "openai.gpt-5.5",
        url: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
        npm: "@ai-sdk/amazon-bedrock/mantle",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "medium" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "medium" },
    })
  })

  test("uses groq slug for groq models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "groq/llama-3.3-70b-versatile",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningFormat: "parsed" })).toEqual({
      groq: { reasoningFormat: "parsed" },
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Inner items should have a default type
    expect(result.properties.values.items.items.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.items.items).toBeDefined()
    expect(result.properties.data.items.items.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.matrix.items.items.items).toBeDefined()
    expect(result.properties.matrix.items.items.items.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Should preserve the explicit type
    expect(result.properties.numbers.items.items.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.spreadsheetData.properties.rows.items.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini type arrays", () => {
  // Mirrors @ai-sdk/google's convertJSONSchemaToOpenAPISchema: JSON Schema type
  // arrays (e.g. `["number","string"]`, common in MCP tool schemas) become an
  // `anyOf` of single-type schemas, with `null` lifted into `nullable`. Plain
  // @ai-sdk/google rewrites these, but OpenAI-compatible transports such as
  // GitHub Copilot (proxying to Gemini) forward them verbatim and the backend
  // rejects the array form.
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("splits a multi-type array into anyOf and drops the type array", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: ["number", "string"], description: "status filter" },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.status.type).toBeUndefined()
    expect(result.properties.status.anyOf).toEqual([{ type: "number" }, { type: "string" }])
    expect(result.properties.status.nullable).toBeUndefined()
    // Sibling keywords stay alongside the generated anyOf.
    expect(result.properties.status.description).toBe("status filter")
  })

  test("lifts null into nullable for a nullable type array", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: ["string", "null"], description: "nullable string" },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.maybe.type).toBeUndefined()
    expect(result.properties.maybe.anyOf).toEqual([{ type: "string" }])
    expect(result.properties.maybe.nullable).toBe(true)
  })

  test("collapses an all-null type array to type null", () => {
    const schema = {
      type: "object",
      properties: {
        nothing: { type: ["null"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nothing.type).toBe("null")
    expect(result.properties.nothing.anyOf).toBeUndefined()
  })

  test("rewrites type arrays for gemini served through github-copilot", () => {
    const copilotGeminiModel = {
      providerID: "github-copilot",
      api: {
        id: "gemini-3.5-flash",
        npm: "@ai-sdk/github-copilot",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        hook_id: { type: "number", description: "ID of the webhook" },
        status: { type: ["number", "string"], description: "Filter by response status code" },
      },
      required: ["hook_id"],
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(copilotGeminiModel, schema) as any

    expect(result.properties.status.anyOf).toEqual([{ type: "number" }, { type: "string" }])
    expect(result.properties.status.type).toBeUndefined()
    expect(result.properties.hook_id.type).toBe("number")
  })
})

describe("ProviderTransform.schema - gemini combiner nodes", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  const walk = (node: any, cb: (node: any, path: (string | number)[]) => void, path: (string | number)[] = []) => {
    if (node === null || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, cb, [...path, i]))
      return
    }
    cb(node, path)
    Object.entries(node).forEach(([key, value]) => walk(value, cb, [...path, key]))
  }

  test("keeps edits.items.anyOf without adding type", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                  replace_all: { type: "boolean" },
                },
                required: ["old_string", "new_string"],
              },
            ],
          },
        },
      },
      required: ["edits"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(Array.isArray(result.properties.edits.items.anyOf)).toBe(true)
    expect(result.properties.edits.items.type).toBeUndefined()
  })

  test("does not add sibling keys to combiner nodes during sanitize", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
        },
        meta: {
          allOf: [
            {
              type: "object",
              properties: { a: { type: "string" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" } },
            },
          ],
        },
      },
    } as any
    const input = JSON.parse(JSON.stringify(schema))
    const result = ProviderTransform.schema(geminiModel, schema) as any

    walk(result, (node, path) => {
      const hasCombiner = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf)
      if (!hasCombiner) {
        return
      }
      const before = path.reduce((acc: any, key) => acc?.[key], input)
      const added = Object.keys(node).filter((key) => !(key in before))
      expect(added).toEqual([])
    })
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("string")
    expect(result.properties.data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("array")
    expect(result.properties.data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.outer.properties.inner.type).toBe("number")
    expect(result.properties.outer.properties.inner.properties).toBeUndefined()
    expect(result.properties.outer.properties.inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("object")
    expect(result.properties.data.properties).toBeDefined()
    expect(result.properties.data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    expect(result.properties.data.properties).toBeDefined()
  })
})

describe("ProviderTransform.schema - openai supported schema subset", () => {
  const openaiModel = {
    providerID: "openai",
    api: {
      id: "gpt-4.1",
      npm: "@ai-sdk/openai",
    },
  } as any

  test("removes unsupported JSON Schema keywords recursively", () => {
    const result = ProviderTransform.schema(openaiModel, {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Search",
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
          format: "uri",
          pattern: "^https://",
          minLength: 1,
          maxLength: 100,
          default: "https://example.com",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          multipleOf: 1,
        },
        createdAt: {
          format: "date-time",
        },
        mode: {
          const: "fast",
        },
        tags: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        tuple: {
          type: "array",
          items: [
            { type: "number", minimum: 0 },
            { type: "string", pattern: "^ok$" },
          ],
        },
        metadata: {
          type: "object",
          patternProperties: {
            "^x-": { type: "string" },
          },
          additionalProperties: {
            type: "string",
            pattern: "^safe$",
          },
        },
      },
      patternProperties: {
        "^extra": { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    } as any) as any

    expect(result).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        count: {
          type: "integer",
        },
        createdAt: {
          type: "string",
        },
        mode: {
          enum: ["fast"],
          type: "string",
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
        tuple: {
          type: "array",
          items: [{ type: "number" }, { type: "string" }],
        },
        metadata: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "string",
          },
        },
      },
      required: ["query"],
      additionalProperties: false,
    })
  })

  test("keeps local references and sanitizes definitions", () => {
    const result = ProviderTransform.schema(openaiModel, {
      type: "object",
      properties: {
        value: {
          $ref: "#/$defs/Value",
          description: "Referenced value",
          examples: ["ignored"],
        },
      },
      $defs: {
        Value: {
          type: "string",
          pattern: "^value$",
          description: "Definition description",
        },
        Unused: {
          type: "number",
          minimum: 0,
        },
      },
    } as any) as any

    expect(result.properties.value).toEqual({
      $ref: "#/$defs/Value",
      description: "Referenced value",
    })
    expect(result.$defs).toEqual({
      Value: {
        type: "string",
        description: "Definition description",
      },
      Unused: {
        type: "number",
      },
    })
  })

  test("does not sanitize non-openai providers", () => {
    const result = ProviderTransform.schema(
      {
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4",
          npm: "@ai-sdk/anthropic",
        },
      } as any,
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            pattern: "^https://",
          },
        },
      } as any,
    ) as any

    expect(result.properties.query.pattern).toBe("^https://")
  })

  test.each([
    ["opencode", "@ai-sdk/openai"],
    ["custom-openai-compatible", "@ai-sdk/openai"],
    ["azure", "@ai-sdk/azure"],
  ])("sanitizes %s models using %s", (providerID, npm) => {
    expect(
      ProviderTransform.schema(
        {
          providerID,
          api: {
            id: "custom-model",
            npm,
          },
        } as any,
        {
          type: "object",
          properties: {
            query: {
              type: "string",
              pattern: "^https://",
            },
          },
        } as any,
      ),
    ).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
        },
      },
    })
  })
})

describe("ProviderTransform.schema - moonshot $ref siblings", () => {
  const moonshotModel = {
    providerID: "moonshotai",
    api: {
      id: "kimi-k2",
    },
  } as any

  test("removes sibling descriptions from referenced tool parameter schemas", () => {
    const schema = {
      type: "object",
      properties: {
        deviceType: {
          description: "Optional. The type of device that captured the screenshot, e.g. mobile or desktop.",
          enum: ["DEVICE_TYPE_UNSPECIFIED", "MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"],
          type: "string",
        },
        modelId: {
          description: "Optional. The model to use for generation.",
          enum: ["MODEL_ID_UNSPECIFIED", "GEMINI_3_PRO", "GEMINI_3_FLASH", "GEMINI_3_1_PRO"],
          type: "string",
        },
        projectId: {
          description: "Required. The project ID of screens to generate variants for.",
          type: "string",
        },
        prompt: {
          description: "Required. The input text used to generate the variants.",
          type: "string",
        },
        selectedScreenIds: {
          description: "Required. The screen ids of screen to generate variants for.",
          items: {
            type: "string",
          },
          type: "array",
        },
        variantOptions: {
          $ref: "#/$defs/VariantOptions",
          description:
            "Required. The variant options for generation, including the number of variants, creative range, and aspects to focus on.",
        },
      },
      required: ["projectId", "selectedScreenIds", "prompt", "variantOptions"],
      $defs: {
        VariantOptions: {
          description:
            "Configuration options for design variant generation. This message captures all parameters used to generate variants, allowing the configuration to be stored, replayed, or analyzed.",
          properties: {
            aspects: {
              description: "Optional. Specific aspects to focus on. If empty, all aspects may be varied.",
              items: {
                enum: ["VARIANT_ASPECT_UNSPECIFIED", "LAYOUT", "COLOR_SCHEME", "IMAGES", "TEXT_FONT", "TEXT_CONTENT"],
                type: "string",
              },
              type: "array",
            },
            creativeRange: {
              description: "Optional. Creative range for variations. Default: EXPLORE",
              enum: ["CREATIVE_RANGE_UNSPECIFIED", "REFINE", "EXPLORE", "REIMAGINE"],
              type: "string",
            },
            variantCount: {
              description: "Optional. Number of variants to generate (1-5). Default: 3",
              format: "int32",
              type: "integer",
            },
          },
          type: "object",
        },
      },
      description: "Request message for GenerateVariants.",
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(moonshotModel, schema) as any

    expect(result.properties.variantOptions).toEqual({
      $ref: "#/$defs/VariantOptions",
    })
    expect(result.$defs.VariantOptions.description).toBe(schema.$defs.VariantOptions.description)
  })

  test("also runs for kimi models outside the moonshot provider", () => {
    const result = ProviderTransform.schema(
      {
        providerID: "openrouter",
        name: "Kimi K2",
        api: {
          id: "moonshotai/kimi-k2",
        },
      } as any,
      {
        type: "object",
        properties: {
          value: {
            $ref: "#/$defs/Value",
            description: "Moonshot rejects this sibling after ref expansion.",
          },
        },
        $defs: {
          Value: {
            description: "Referenced schema description stays here.",
            type: "object",
          },
        },
      } as any,
    ) as any

    expect(result.properties.value).toEqual({
      $ref: "#/$defs/Value",
    })
  })

  test("converts tuple-style array items to a single item schema", () => {
    const result = ProviderTransform.schema(moonshotModel, {
      type: "object",
      properties: {
        codeSpec: {
          type: "object",
          properties: {
            accessibility: {
              type: "object",
              properties: {
                renderedSize: {
                  description: "Rendered size [width, height] in px",
                  type: "array",
                  items: [{ type: "number" }, { type: "number" }],
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          },
        },
      },
    } as any) as any

    expect(result.properties.codeSpec.properties.accessibility.properties.renderedSize.items).toEqual({
      type: "number",
    })
  })
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelV2.ID.make("deepseek/deepseek-chat"),
        providerID: ProviderV2.ID.make("deepseek"),
        api: {
          id: "deepseek-chat",
          url: "https://api.deepseek.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "DeepSeek Chat",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: {
            field: "reasoning_content",
          },
        },
        cost: {
          input: 0.001,
          output: 0.002,
          cache: { read: 0.0001, write: 0.0002 },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelV2.ID.make("openai/gpt-4"),
        providerID: ProviderV2.ID.make("openai"),
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0.03,
          output: 0.06,
          cache: { read: 0.001, write: 0.002 },
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - surrogate sanitization", () => {
  const model = {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("replaces lone surrogates in model-visible text", () => {
    const lone = "\uD83D"
    const valid = "🚀"
    const sanitized = "�"
    const text = (label: string) => `${label} ${lone} and ${valid}`
    const expected = (label: string) => `${label} ${sanitized} and ${valid}`
    const msgs = [
      { role: "system", content: text("system") },
      { role: "user", content: text("user string") },
      {
        role: "user",
        content: [
          { type: "text", text: text("user text") },
          { type: "image", image: "data:image/png;base64,abcd" },
        ],
      },
      { role: "assistant", content: text("assistant string") },
      {
        role: "assistant",
        content: [
          { type: "text", text: text("assistant text") },
          { type: "reasoning", text: text("assistant reasoning") },
          { type: "tool-call", toolCallId: "call-1", toolName: "Read", input: { filePath: ".opencode/tool/emoji.ts" } },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "Read",
            output: { type: "text", value: text("assistant tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-3",
            toolName: "Read",
            output: { type: "error-text", value: text("assistant tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-4",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("assistant tool content") }] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-5",
            toolName: "Read",
            output: { type: "text", value: text("tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-6",
            toolName: "Read",
            output: { type: "error-text", value: text("tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-7",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("tool content") }] },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toBe(expected("system"))
    expect(result[1].content).toBe(expected("user string"))
    expect(result[2].content[0].text).toBe(expected("user text"))
    expect(result[3].content).toBe(expected("assistant string"))
    expect(result[4].content[0].text).toBe(expected("assistant text"))
    expect(result[4].content[1].text).toBe(expected("assistant reasoning"))
    expect(result[4].content[3].output.value).toBe(expected("assistant tool text"))
    expect(result[4].content[4].output.value).toBe(expected("assistant tool error"))
    expect(result[4].content[5].output.value[0].text).toBe(expected("assistant tool content"))
    expect(result[5].content[0].output.value).toBe(expected("tool text"))
    expect(result[5].content[1].output.value).toBe(expected("tool error"))
    expect(result[5].content[2].output.value[0].text).toBe(expected("tool content"))
    expect(result[2].content[1]).toEqual({ type: "image", image: "data:image/png;base64,abcd" })
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})

describe("ProviderTransform.message - anthropic empty content filtering", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
  })

  test("filters out empty reasoning parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
          { type: "reasoning", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("keeps non-text/reasoning parts even if text parts are empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "123",
      toolName: "bash",
      input: { command: "ls" },
    })
  })

  test("keeps messages with valid text alongside empty parts", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "" },
          { type: "text", text: "Result" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
    expect(result[0].content[1]).toEqual({ type: "text", text: "Result" })
  })

  test("filters empty content for bedrock provider", () => {
    const bedrockModel = {
      ...anthropicModel,
      id: "amazon-bedrock/anthropic.claude-opus-4-6",
      providerID: "amazon-bedrock",
      api: {
        id: "anthropic.claude-opus-4-6",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    }

    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, bedrockModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toHaveLength(1)
    expect(result[1].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("does not filter for non-anthropic providers", () => {
    const openaiModel = {
      ...anthropicModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }

    const msgs = [
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("")
    expect(result[1].content).toHaveLength(1)
  })

  test("leaves valid anthropic assistant tool ordering unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I checked your home directory and looked for PDF files." },
          { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
          { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content).toMatchObject([
      { type: "text", text: "I checked your home directory and looked for PDF files." },
      { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
      { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
    ])
  })
})

describe("ProviderTransform.message - strip openai metadata when store=false", () => {
  const openaiModel = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("strips OpenAI itemId and preserves reasoningEncryptedContent when store=false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.reasoningEncryptedContent).toBe("encrypted")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBeUndefined()
  })

  test("uses the SDK package namespace rather than provider ID", () => {
    const zenModel = {
      ...openaiModel,
      providerID: "zen",
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, zenModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.reasoningEncryptedContent).toBe("encrypted")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBeUndefined()
  })

  test("preserves other OpenAI options", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.otherOption).toBe("value")
  })

  test("strips Azure itemId from the Azure namespace", () => {
    const azureModel = {
      ...openaiModel,
      providerID: "azure",
      api: {
        id: "gpt-5",
        url: "https://example.openai.azure.com",
        npm: "@ai-sdk/azure",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              azure: { itemId: "msg_123", otherOption: "value" },
              openai: { itemId: "msg_openai" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, azureModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.azure?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.azure?.otherOption).toBe("value")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai")
  })

  test("strips Bedrock Mantle itemId from the OpenAI namespace", () => {
    const mantleModel = {
      ...openaiModel,
      providerID: "amazon-bedrock",
      api: {
        id: "openai.gpt-5.5",
        url: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
        npm: "@ai-sdk/amazon-bedrock/mantle",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: { openai: { itemId: "msg_root", otherOption: "root-value" } },
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: { itemId: "rs_123", reasoningEncryptedContent: "encrypted" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mantleModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].providerOptions?.openai?.otherOption).toBe("root-value")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.reasoningEncryptedContent).toBe("encrypted")
  })

  test("strips GitHub Copilot itemId from the copilot namespace, preserving other copilot options", () => {
    const copilotModel = {
      ...openaiModel,
      id: "github-copilot/gpt-5.5",
      providerID: "github-copilot",
      api: {
        id: "gpt-5.5",
        url: "https://api.githubcopilot.com",
        npm: "@ai-sdk/github-copilot",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              copilot: { itemId: "rs_123", reasoningEncryptedContent: "encrypted" },
            },
          },
          {
            // The stale itemId on tool-call parts is what Copilot echoes back as the
            // `function_call` item `id`, which is what the upstream connection rejects.
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "bash",
            input: { command: "ls" },
            providerOptions: {
              copilot: { itemId: "fc_456", reasoningEffort: "medium" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, copilotModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.copilot?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.copilot?.reasoningEncryptedContent).toBe("encrypted")
    expect(result[0].content[1].providerOptions?.copilot?.itemId).toBeUndefined()
    expect(result[0].content[1].providerOptions?.copilot?.reasoningEffort).toBe("medium")
  })

  test("leaves a stray openai namespace on a Copilot model untouched, since Copilot's Responses model only reads the copilot namespace", () => {
    const copilotModel = {
      ...openaiModel,
      id: "github-copilot/gpt-5.5",
      providerID: "github-copilot",
      api: {
        id: "gpt-5.5",
        url: "https://api.githubcopilot.com",
        npm: "@ai-sdk/github-copilot",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_456" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, copilotModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves metadata for openai package when store is true", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // openai package preserves itemId regardless of store value
    const result = ProviderTransform.message(msgs, openaiModel, { store: true }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata for non-openai packages when store is false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // store=false preserves metadata for non-openai packages
    const result = ProviderTransform.message(msgs, anthropicModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata using providerID key when store is false", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              opencode: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.opencode?.otherOption).toBe("value")
  })

  test("preserves itemId across all providerOptions keys", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: {
          openai: { itemId: "msg_root" },
          opencode: { itemId: "msg_opencode" },
          extra: { itemId: "msg_extra" },
        },
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_openai_part" },
              opencode: { itemId: "msg_opencode_part" },
              extra: { itemId: "msg_extra_part" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBe("msg_root")
    expect(result[0].providerOptions?.opencode?.itemId).toBe("msg_opencode")
    expect(result[0].providerOptions?.extra?.itemId).toBe("msg_extra")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai_part")
    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_opencode_part")
    expect(result[0].content[0].providerOptions?.extra?.itemId).toBe("msg_extra_part")
  })

  test("does not strip metadata for non-openai packages when store is not false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })
})

describe("ProviderTransform.message - providerOptions key remapping", () => {
  const createModel = (providerID: string, npm: string) =>
    ({
      id: `${providerID}/test-model`,
      providerID,
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm,
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("azure keeps 'azure' key and does not remap to 'openai'", () => {
    const model = createModel("azure", "@ai-sdk/azure")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          azure: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.azure).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.openai).toBeUndefined()
  })

  test("azure cognitive services remaps providerID to 'azure' key", () => {
    const model = createModel("azure-cognitive-services", "@ai-sdk/azure")
    const msgs = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              "azure-cognitive-services": { part: true },
            },
          },
        ],
        providerOptions: {
          "azure-cognitive-services": { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]
    const part = result[0].content[0] as any

    expect(result[0].providerOptions?.azure).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["azure-cognitive-services"]).toBeUndefined()
    expect(part.providerOptions?.azure).toEqual({ part: true })
    expect(part.providerOptions?.["azure-cognitive-services"]).toBeUndefined()
  })

  test("copilot remaps providerID to 'copilot' key", () => {
    const model = createModel("github-copilot", "@ai-sdk/github-copilot")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          copilot: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.copilot).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["github-copilot"]).toBeUndefined()
  })

  test("bedrock remaps providerID to 'bedrock' key", () => {
    const model = createModel("my-bedrock", "@ai-sdk/amazon-bedrock")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          "my-bedrock": { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["my-bedrock"]).toBeUndefined()
  })
})

describe("ProviderTransform.message - claude w/bedrock custom inference profile", () => {
  test("adds cachePoint", () => {
    const model = {
      id: "amazon-bedrock/custom-claude-sonnet-4.5",
      providerID: "amazon-bedrock",
      api: {
        id: "arn:aws:bedrock:xxx:yyy:application-inference-profile/zzz",
        url: "https://api.test.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
      name: "Custom inference profile",
      capabilities: {},
      options: {},
      headers: {},
    } as any

    const msgs = [
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual(
      expect.objectContaining({
        cachePoint: {
          type: "default",
        },
      }),
    )
  })
})

describe("ProviderTransform.message - bedrock caching with non-bedrock providerID", () => {
  test("applies cache options at message level when npm package is amazon-bedrock", () => {
    const model = {
      id: "aws/us.anthropic.claude-opus-4-6-v1",
      providerID: "aws",
      api: {
        id: "us.anthropic.claude-opus-4-6-v1",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
      name: "Claude Opus 4.6",
      capabilities: {},
      options: {},
      headers: {},
    } as any

    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    // Cache should be at the message level and not the content-part level
    expect(result[0].providerOptions?.bedrock).toEqual({
      cachePoint: { type: "default" },
    })
    expect(result[0].content).toBe("You are a helpful assistant")
  })
})

describe("ProviderTransform.message - cache control on gateway", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
      name: "Claude Sonnet 4",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 200_000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  test("gateway does not set cache control for anthropic models", () => {
    const model = createModel()
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toBe("You are a helpful assistant")
    expect(result[0].providerOptions).toBeUndefined()
  })

  test("non-gateway anthropic keeps existing cache control behavior", () => {
    const model = createModel({
      providerID: "anthropic",
      api: {
        id: "claude-sonnet-4",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual({
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      openrouter: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      bedrock: {
        cachePoint: {
          type: "default",
        },
      },
      openaiCompatible: {
        cache_control: {
          type: "ephemeral",
        },
      },
      copilot: {
        copilot_cache_control: {
          type: "ephemeral",
        },
      },
      alibaba: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    })
  })

  test("google-vertex-anthropic applies cache control", () => {
    const model = createModel({
      providerID: "google-vertex-anthropic",
      api: {
        id: "google-vertex-anthropic",
        url: "https://us-central1-aiplatform.googleapis.com",
        npm: "@ai-sdk/google-vertex/anthropic",
      },
      id: "claude-sonnet-4@20250514",
    })
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual({
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      openrouter: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      bedrock: {
        cachePoint: {
          type: "default",
        },
      },
      openaiCompatible: {
        cache_control: {
          type: "ephemeral",
        },
      },
      copilot: {
        copilot_cache_control: {
          type: "ephemeral",
        },
      },
      alibaba: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    })
  })
})

describe("ProviderTransform.temperature - Cohere North", () => {
  test("defaults north-mini-code models to 1.0", () => {
    expect(ProviderTransform.temperature({ id: "cohere/North-Mini-Code-1-0-latest" } as any)).toBe(1.0)
  })
})

describe("ProviderTransform.variants", () => {
  const createModel = (npm: string, reasoning_options?: Provider.Model["reasoning_options"]): Provider.Model =>
    ({
      id: ModelV2.ID.make("test-model"),
      providerID: ProviderV2.ID.make("test"),
      api: { id: "test-model", url: "https://api.test", npm },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      reasoning_options,
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128_000, output: 64_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {},
    }) as Provider.Model

  test("uses effort metadata in source order", () => {
    expect(
      ProviderTransform.variants(
        createModel("@ai-sdk/openai", [
          { type: "effort", values: ["none", "low", "xhigh"] },
          { type: "budget_tokens", min: 1024, max: 64_000 },
        ]),
      ),
    ).toEqual({
      none: {
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
      low: {
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
      xhigh: {
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    })
  })

  test("maps effort metadata to provider settings", () => {
    const options = [{ type: "effort" as const, values: ["high"] }]
    expect(ProviderTransform.variants(createModel("@openrouter/ai-sdk-provider", options))).toEqual({
      high: { reasoning: { effort: "high" } },
    })
    expect(ProviderTransform.variants(createModel("@ai-sdk/anthropic", options))).toEqual({
      high: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
    })
    expect(ProviderTransform.variants(createModel("@ai-sdk/google", options))).toEqual({
      high: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
    })
    expect(ProviderTransform.variants(createModel("@ai-sdk/azure", options))).toEqual({
      high: { reasoningEffort: "high" },
    })
    expect(ProviderTransform.variants(createModel("@ai-sdk/openai-compatible", options))).toEqual({
      high: { reasoningEffort: "high" },
    })
  })

  test("uses budget metadata when effort metadata is absent", () => {
    const options = [{ type: "budget_tokens" as const, min: 1024, max: 64_000 }]
    expect(ProviderTransform.variants(createModel("@ai-sdk/anthropic", options))).toEqual({
      high: { thinking: { type: "enabled", budgetTokens: 16_000 } },
      max: { thinking: { type: "enabled", budgetTokens: 64_000 } },
    })
    expect(ProviderTransform.variants(createModel("@openrouter/ai-sdk-provider", options))).toEqual({
      high: { reasoning: { max_tokens: 16_000 } },
      max: { reasoning: { max_tokens: 64_000 } },
    })
  })

  test("omits toggle-only and unsupported provider variants", () => {
    expect(ProviderTransform.variants(createModel("@ai-sdk/openai", [{ type: "toggle" }]))).toEqual({})
    expect(
      ProviderTransform.variants(createModel("@ai-sdk/amazon-bedrock", [{ type: "effort", values: ["high"] }])),
    ).toEqual({})
  })

  test("retains the OpenAI-compatible GLM 5.2 fallback", () => {
    const model = createModel("@ai-sdk/openai-compatible")
    model.api.id = "accounts/fireworks/models/glm-5p2"
    expect(ProviderTransform.variants(model)).toEqual({
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
  })
})

describe("ProviderTransform.smallOptions - gpt-5 chat/search", () => {
  const createModel = (apiId: string, efforts: string[]) => {
    const model = {
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      capabilities: { reasoning: true },
      reasoning_options: [{ type: "effort", values: efforts }],
      limit: { output: 64_000 },
      release_date: "2026-01-01",
    } as any
    model.variants = ProviderTransform.variants(model)
    return model
  }

  for (const testCase of [
    { id: "gpt-5-chat-latest", efforts: [], options: { store: false } },
    {
      id: "gpt-5.1-chat-latest",
      efforts: ["medium"],
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5.2-chat-latest",
      efforts: ["medium"],
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5-search-api",
      efforts: ["none"],
      options: {
        store: false,
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  ]) {
    test(`${testCase.id} returns only supported small options`, () => {
      expect(ProviderTransform.smallOptions(createModel(testCase.id, testCase.efforts))).toEqual(testCase.options)
    })
  }
})

test("ProviderTransform.smallOptions preserves the weakest OpenRouter reasoning effort", () => {
  expect(
    ProviderTransform.smallOptions({
      providerID: "openrouter",
      api: {
        id: "google/gemini-3.5-flash",
        npm: "@openrouter/ai-sdk-provider",
      },
      variants: {
        low: { reasoning: { effort: "low" } },
        medium: { reasoning: { effort: "medium" } },
        high: { reasoning: { effort: "high" } },
      },
    } as any),
  ).toEqual({ reasoning: { effort: "low" } })
})

describe("ProviderTransform.smallOptions - google thinking controls", () => {
  const createGoogleModel = (apiId: string, reasoning_options: Provider.Model["reasoning_options"]) => {
    const model = {
      id: `google/${apiId}`,
      providerID: "google",
      api: {
        id: apiId,
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
      capabilities: { reasoning: true },
      reasoning_options,
      limit: { output: 64_000 },
    } as any
    model.variants = ProviderTransform.variants(model)
    return model
  }

  for (const testCase of [
    {
      id: "gemini-3-pro-preview",
      reasoning_options: [{ type: "effort" as const, values: ["low", "medium", "high"] }],
      options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
    },
    {
      id: "gemini-3-flash-preview",
      reasoning_options: [{ type: "effort" as const, values: ["minimal", "low", "medium", "high"] }],
      options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } },
    },
    {
      id: "gemini-3.1-flash-image-preview",
      reasoning_options: [{ type: "effort" as const, values: ["minimal", "high"] }],
      options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } },
    },
    {
      id: "gemini-3-pro-image-preview",
      reasoning_options: [{ type: "effort" as const, values: ["high"] }],
      options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
    },
    {
      id: "gemini-2.5-pro",
      reasoning_options: [{ type: "budget_tokens" as const, min: 1024, max: 32_768 }],
      options: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
    },
    {
      id: "gemini-2.5-flash",
      reasoning_options: [{ type: "budget_tokens" as const, min: 1024, max: 24_576 }],
      options: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
    },
  ]) {
    test(`${testCase.id} returns supported small thinking options`, () => {
      expect(ProviderTransform.smallOptions(createGoogleModel(testCase.id, testCase.reasoning_options))).toEqual(
        testCase.options,
      )
    })
  }

  test("uses the first configured variant when available", () => {
    expect(
      ProviderTransform.smallOptions({
        ...createGoogleModel("gemini-2.5-pro", [{ type: "budget_tokens", min: 1024, max: 32_768 }]),
        variants: {
          high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
          max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 32768 } },
        },
      }),
    ).toEqual({ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } })
  })

  test("does not synthesize thinking options when variants are empty", () => {
    expect(
      ProviderTransform.smallOptions({
        ...createGoogleModel("gemini-2.5-pro", [{ type: "budget_tokens", min: 1024, max: 32_768 }]),
        variants: {},
      }),
    ).toEqual({})
  })
})

describe("ProviderTransform.providerOptions - ai-gateway-provider", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "cloudflare-ai-gateway/openai/gpt-5.4",
      providerID: "cloudflare-ai-gateway",
      api: {
        id: "openai/gpt-5.4",
        url: "https://gateway.ai.cloudflare.com/v1/compat",
        npm: "ai-gateway-provider",
      },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      limit: { context: 1_000_000, output: 128_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-03-05",
      ...overrides,
    }) as any

  test("routes options under openaiCompatible (the key @ai-sdk/openai-compatible reads)", () => {
    // Regression: previously fell back to providerID="cloudflare-ai-gateway",
    // which @ai-sdk/openai-compatible never reads, silently dropping reasoningEffort.
    const result = ProviderTransform.providerOptions(createModel(), { reasoningEffort: "high" })
    expect(result).toEqual({ openaiCompatible: { reasoningEffort: "high" } })
  })
})

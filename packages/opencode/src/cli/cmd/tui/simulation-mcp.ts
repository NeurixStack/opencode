import { SimulationActions } from "@/testing/simulation/actions"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CapturedFrame, CliRenderer } from "@opentui/core"
import { createMockKeys, createMockMouse } from "@opentui/core/testing"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import z from "zod/v4"
import type { SimulationRenderer } from "./simulation"

export type SimulationMcpMode = "stdio" | "remote"

export interface SimulationMcpHarness {
  readonly renderer: CliRenderer
  readonly mockInput: SimulationActions.MockInput
  readonly mockMouse: SimulationActions.MockMouse
  readonly renderOnce: () => Promise<void>
  readonly screen: () => string
}

export interface SimulationMcpOptions {
  readonly mode: SimulationMcpMode
  readonly harness: SimulationMcpHarness
  readonly controlUrl: string
  readonly controlFetch?: typeof fetch
}

export interface SimulationMcpRuntimeState {
  readonly harness: SimulationMcpHarness
  readonly controlUrl: string
  readonly controlFetch?: typeof fetch
}

export interface RestartableSimulationMcpOptions {
  readonly mode: SimulationMcpMode
  readonly runtime: {
    readonly current: () => SimulationMcpRuntimeState | undefined
    readonly restart: () => Promise<unknown>
  }
}

type Options = SimulationMcpOptions | RestartableSimulationMcpOptions

export interface SimulationMcpServer {
  readonly mode: SimulationMcpMode
  readonly url?: string
  readonly stop: () => Promise<void>
}

const DefaultRemotePort = 43110
const MaxPortAttempts = 100

type RenderBuffer = {
  readonly width: number
  readonly height: number
  getRealCharBytes(includeAnsi?: boolean): Uint8Array
}

const decoder = new TextDecoder()

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("typeText"), text: z.string() }),
  z.object({ type: z.literal("pressEnter") }),
  z.object({ type: z.literal("pressArrow"), direction: z.enum(["up", "down", "left", "right"]) }),
  z.object({ type: z.literal("focus"), target: z.number() }),
  z.object({ type: z.literal("click"), target: z.number(), x: z.number(), y: z.number() }),
]) satisfies z.ZodType<SimulationActions.Action>

const FileContentSchema = z.union([
  z.string(),
  z.object({ encoding: z.literal("base64"), data: z.string() }),
])

const NetworkRegistrationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("json"),
    url: z.string(),
    method: z.string().optional(),
    status: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown(),
  }),
  z.object({
    kind: z.literal("text"),
    url: z.string(),
    method: z.string().optional(),
    status: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("status"),
    url: z.string(),
    method: z.string().optional(),
    status: z.number(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

const LlmScriptActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("thinking"), content: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
])

const LlmScriptSchema = z.object({
  steps: z.array(z.array(LlmScriptActionSchema)),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  finish: z.enum(["stop", "tool-calls", "error", "length", "unknown"]).optional(),
})

function currentBuffer(renderer: CliRenderer): RenderBuffer {
  return Reflect.get(renderer, "currentRenderBuffer") as RenderBuffer
}

function remotePort() {
  const port = Number(process.env.OPENCODE_SIMULATION_MCP_PORT)
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port
  return DefaultRemotePort
}

function isPortUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes("eaddrinuse") || message.includes("address already in use") || message.includes(" in use")
}

function serveRemote(
  fetch: (request: Request) => Response | Promise<Response>,
  port = remotePort(),
  attempts = MaxPortAttempts,
): ReturnType<typeof Bun.serve> {
  try {
    return Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, fetch })
  } catch (error) {
    if (!isPortUnavailable(error) || attempts <= 1 || port >= 65535) throw error
    return serveRemote(fetch, port + 1, attempts - 1)
  }
}

export function harnessFromSimulationRenderer(renderer: SimulationRenderer): SimulationMcpHarness {
  return renderer
}

export function harnessFromRenderer(renderer: CliRenderer): SimulationMcpHarness {
  return {
    renderer,
    mockInput: createMockKeys(renderer),
    mockMouse: createMockMouse(renderer),
    renderOnce: async () => {
      renderer.requestRender()
      await renderer.idle()
    },
    screen: () => decoder.decode(currentBuffer(renderer).getRealCharBytes(true)),
  }
}

function toolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

function current(options: Options) {
  if ("runtime" in options) {
    const value = options.runtime.current()
    if (value) return value
    throw new Error("Simulation TUI is not ready")
  }
  return options
}

function state(options: Options) {
  const running = current(options)
  return {
    focused: {
      renderable: running.harness.renderer.currentFocusedRenderable?.num,
      editor: Boolean(running.harness.renderer.currentFocusedEditor),
    },
    elements: SimulationActions.elements(running.harness.renderer),
    actions: SimulationActions.actions(running.harness.renderer),
  }
}

function snapshot(options: Options) {
  const running = current(options)
  return {
    screen: running.harness.screen(),
    ui: state(options),
  }
}

async function control(options: Options, method: string, pathname: string, body?: unknown) {
  const running = current(options)
  const response = await (running.controlFetch ?? fetch)(new URL(pathname, running.controlUrl), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  if (response.ok) return data
  throw new Error(typeof data?.error === "string" ? data.error : `Simulation control request failed: ${response.status}`)
}

function createServer(options: Options) {
  const server = new McpServer(
    { name: "opencode-simulation", version: InstallationVersion },
    {
      instructions:
        "Use simulation_ui_state_get before acting. Prefer generated actions and execute them with simulation_action_execute. Inspect state after each action. Use control tools to seed filesystem, network, and LLM state.",
    },
  )

  server.registerResource("screen", "simulation://screen", { mimeType: "text/plain" }, () => ({
    contents: [{ uri: "simulation://screen", mimeType: "text/plain", text: current(options).harness.screen() }],
  }))
  server.registerResource("ui-state", "simulation://ui-state", { mimeType: "application/json" }, () => ({
    contents: [{ uri: "simulation://ui-state", mimeType: "application/json", text: JSON.stringify(state(options)) }],
  }))
  server.registerResource("backend-snapshot", "simulation://backend-snapshot", { mimeType: "application/json" }, async () => ({
    contents: [
      {
        uri: "simulation://backend-snapshot",
        mimeType: "application/json",
        text: JSON.stringify(await control(options, "GET", "/experimental/simulation/snapshot")),
      },
    ],
  }))

  server.registerPrompt("simulation-driver", { description: "Instructions for driving the simulated TUI." }, () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Inspect simulation_ui_state_get, choose one generated action, call simulation_action_execute, then inspect again. Use control tools to seed deterministic backend state.",
        },
      },
    ],
  }))

  server.registerTool("simulation_screen_get", { description: "Get the current TUI screen buffer." }, () =>
    toolResult({ screen: current(options).harness.screen() }),
  )
  server.registerTool("simulation_ui_state_get", { description: "Get elements, focus state, and generated actions." }, () =>
    toolResult(state(options)),
  )
  server.registerTool("simulation_render_once", { description: "Force one render and return current state." }, async () => {
    await current(options).harness.renderOnce()
    return toolResult(snapshot(options))
  })
  server.registerTool(
    "simulation_action_execute",
    {
      description: "Execute one generated simulation action and render once.",
      inputSchema: z.object({ action: ActionSchema }),
    },
    async (input) => {
      await SimulationActions.execute(current(options).harness, input.action)
      return toolResult(snapshot(options))
    },
  )
  server.registerTool(
    "simulation_action_sequence_execute",
    {
      description: "Execute a bounded sequence of simulation actions and return final state.",
      inputSchema: z.object({ actions: z.array(ActionSchema).max(50) }),
    },
    async (input) => {
      for (const action of input.actions) await SimulationActions.execute(current(options).harness, action)
      return toolResult(snapshot(options))
    },
  )

  if ("runtime" in options) {
    server.registerTool("simulation_restart", { description: "Restart the simulated TUI and backend while keeping MCP alive." }, async () =>
      toolResult(await options.runtime.restart()),
    )
  }

  server.registerTool("simulation_control_reset", { description: "Reset backend simulation state." }, async () =>
    toolResult(await control(options, "POST", "/experimental/simulation/reset")),
  )
  server.registerTool(
    "simulation_control_filesystem_seed",
    {
      description: "Seed backend simulated filesystem files.",
      inputSchema: z.object({ files: z.record(z.string(), FileContentSchema) }),
    },
    async (input) => toolResult(await control(options, "POST", "/experimental/simulation/filesystem/seed", input)),
  )
  server.registerTool(
    "simulation_control_network_register",
    {
      description: "Register one backend simulated network response.",
      inputSchema: NetworkRegistrationSchema,
    },
    async (input) => toolResult(await control(options, "POST", "/experimental/simulation/network/register", input)),
  )
  server.registerTool(
    "simulation_control_llm_enqueue",
    {
      description: "Queue backend mock LLM scripts.",
      inputSchema: z.object({ scripts: z.array(LlmScriptSchema) }),
    },
    async (input) => toolResult(await control(options, "POST", "/experimental/simulation/llm/enqueue", input)),
  )
  server.registerTool("simulation_control_snapshot", { description: "Get backend simulation state snapshot." }, async () =>
    toolResult(await control(options, "GET", "/experimental/simulation/snapshot")),
  )

  return server
}

export async function createSimulationMcpServer(options: Options): Promise<SimulationMcpServer> {
  if (options.mode === "stdio") {
    const server = createServer(options)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    return {
      mode: options.mode,
      stop: () => server.close(),
    }
  }

  const servers = new Set<McpServer>()

  const http = serveRemote(
    async (request) => {
      if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 })
      const server = createServer(options)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      servers.add(server)
      request.signal.addEventListener("abort", () => {
        servers.delete(server)
        void server.close()
      })
      await server.connect(transport)
      return transport.handleRequest(request)
    },
  )

  return {
    mode: options.mode,
    url: `http://${http.hostname}:${http.port}/mcp`,
    stop: async () => {
      http.stop(true)
      await Promise.all([...servers].map((server) => server.close()))
      servers.clear()
    },
  }
}

export * as TuiSimulationMcp from "./simulation-mcp"

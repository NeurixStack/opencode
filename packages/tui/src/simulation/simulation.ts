import type { CliRenderer } from "@opentui/core"
import { SimulationActions } from "./actions"
import { SimulationRenderer } from "./renderer"
import { SimulationServer } from "./server"

/**
 * Simulation-mode renderer entry point.
 *
 * Creates the renderer (fake when OPENCODE_SIMULATION_RENDERER=fake, the
 * normal visible renderer otherwise) and starts the simulation control
 * server against it. The server stops when the renderer is destroyed, so the
 * caller only manages the renderer lifecycle.
 */
export async function createSimulation(createVisibleRenderer: () => Promise<CliRenderer>): Promise<CliRenderer> {
  const renderer =
    process.env.OPENCODE_SIMULATION_RENDERER === "fake" ? await SimulationRenderer.create() : await createVisibleRenderer()
  const server = SimulationServer.start(SimulationActions.createHarness(renderer))
  if (server) {
    process.stderr.write(`opencode simulation websocket: ${server.url}\n`)
    renderer.once("destroy", () => server.stop())
  }
  return renderer
}

export * as Simulation from "./simulation"

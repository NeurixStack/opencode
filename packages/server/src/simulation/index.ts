import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SimulationFileSystem } from "./filesystem"
import { SimulationFSUtil } from "./fs-util"

/**
 * Layer replacements applied when the server is built in simulation mode.
 *
 * The server merges these into the app node build when `OPENCODE_SIMULATION`
 * is enabled, via a dynamic import so this module is never loaded eagerly.
 *
 * The fake filesystem is rooted at `OPENCODE_SIMULATION_ROOT` (the real,
 * empty anchor directory the runner created and chdir'd into), falling back
 * to the process working directory. Everything under the root lives in
 * memory; paths outside it fail loudly.
 */
export const simulationReplacements: LayerNode.Replacements = [
  [filesystem, SimulationFileSystem.layer({ root: process.env.OPENCODE_SIMULATION_ROOT })],
  [FSUtil.node, SimulationFSUtil.node],
]

export * as Simulation from "./index"

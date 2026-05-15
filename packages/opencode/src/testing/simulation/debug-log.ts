import fs from "fs/promises"

const file = "/tmp/opencode-simulation-stream.log"

export function reset() {
  void fs.writeFile(file, "")
}

export function write(event: string, data?: unknown) {
  const line = JSON.stringify({ time: new Date().toISOString(), event, data }) + "\n"
  void fs.appendFile(file, line)
}

export * as SimulationDebugLog from "./debug-log"

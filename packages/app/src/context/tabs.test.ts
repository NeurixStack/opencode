import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"
import { normalizeTabColor } from "./tab-color"

describe("tab color", () => {
  test("normalizes valid hex colors", () => {
    expect(normalizeTabColor("#4C8DFF")).toBe("#4c8dff")
    expect(normalizeTabColor("#123abc")).toBe("#123abc")
  })

  test("rejects invalid color values", () => {
    expect(normalizeTabColor(undefined)).toBeUndefined()
    expect(normalizeTabColor("red")).toBeUndefined()
    expect(normalizeTabColor("#fff")).toBeUndefined()
    expect(normalizeTabColor("#12345678")).toBeUndefined()
  })
})

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory(getOwner())
      let disposed = 0
      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)
        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

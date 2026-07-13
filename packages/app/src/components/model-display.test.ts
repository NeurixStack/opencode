import { describe, expect, test } from "bun:test"
import { isFreeModel, modelDisplayName } from "./model-display"

const model = (name: string, provider = "opencode", input = 0) => ({
  name,
  provider: { id: provider },
  cost: { input },
})

describe("model display", () => {
  test("recognizes free models provided by OpenCode", () => {
    expect(isFreeModel(model("GLM 5 Free"))).toBe(true)
    expect(isFreeModel(model("GLM 5 Free", "openrouter"))).toBe(false)
    expect(isFreeModel(model("GLM 5 Free", "opencode", 1))).toBe(false)
  })

  test("removes the standalone free label from free model names", () => {
    expect(modelDisplayName(model("GLM 5 Free"))).toBe("GLM 5")
    expect(modelDisplayName(model("GLM 5 (Free)"))).toBe("GLM 5")
    expect(modelDisplayName(model("Free GLM 5"))).toBe("GLM 5")
  })

  test("preserves names that are not OpenCode free models", () => {
    expect(modelDisplayName(model("GLM 5 Free", "openrouter"))).toBe("GLM 5 Free")
    expect(modelDisplayName(model("FreeModel"))).toBe("FreeModel")
  })
})

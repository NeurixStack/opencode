import { describe, expect, test } from "bun:test"
import {
  formatOldInterfaceSunset,
  layoutTransitionState,
  migrateSettings,
  newLayoutDesignsDefault,
  resolveNewLayoutDesigns,
} from "./settings"

describe("layout transition", () => {
  test("fresh profiles default to the new layout", () => {
    expect(newLayoutDesignsDefault).toBe(true)
    expect(layoutTransitionState(true, false, false, false)).toEqual({ available: false, notice: false })
    expect(layoutTransitionState(true, false, true, false)).toEqual({ available: false, notice: false })
  })

  test("formats the English deadline with an ordinal before sunset", () => {
    const sunset = new Date(2026, 7, 6)
    expect(formatOldInterfaceSunset("en-US", true, sunset)).toBe("August 6th")
    expect(formatOldInterfaceSunset("en-US", false, sunset)).toBe("August 6")
  })

  test("hides the transition until a sunset is scheduled", () => {
    expect(layoutTransitionState(false, true, false, false)).toEqual({ available: false, notice: false })
    expect(formatOldInterfaceSunset("en-US")).toBe("")
  })

  test("existing profiles can switch before sunset", () => {
    expect(migrateSettings({ general: { newLayoutDesigns: false } }, true)).toEqual({
      general: { newLayoutDesigns: false, layoutTransitionEligible: true },
    })
    expect(layoutTransitionState(true, true, false, false)).toEqual({ available: true, notice: false })
  })

  test("existing profiles use their legacy default when no preference was saved", () => {
    expect(migrateSettings({ general: {} }, false)).toEqual({
      general: { newLayoutDesigns: false, layoutTransitionEligible: true },
    })
  })

  test("sunset replaces the toggle with a dismissible notice", () => {
    expect(layoutTransitionState(true, true, true, false)).toEqual({ available: false, notice: true })
    expect(layoutTransitionState(true, true, true, true)).toEqual({ available: false, notice: false })
    expect(resolveNewLayoutDesigns(true, false)).toBe(true)
  })

  test("migration does not reclassify fresh profiles", () => {
    const settings = { general: { newLayoutDesigns: true, layoutTransitionEligible: false } }
    expect(migrateSettings(settings, false)).toBe(settings)
  })
})

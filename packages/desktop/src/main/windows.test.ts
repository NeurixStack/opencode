import { describe, expect, test } from "bun:test"
import { nextWindowIDsAfterClosed } from "./windows-lifecycle"

describe("desktop window persistence", () => {
  test("keeps the last window id when the last window is closed", () => {
    expect(
      nextWindowIDsAfterClosed({
        ids: ["window-a"],
        closed: "window-a",
        remaining: 0,
        appQuitting: false,
      }),
    ).toEqual(["window-a"])
  })

  test("removes only non-final closed window ids", () => {
    expect(
      nextWindowIDsAfterClosed({
        ids: ["window-a", "window-b"],
        closed: "window-a",
        remaining: 1,
        appQuitting: false,
      }),
    ).toEqual(["window-b"])
  })

  test("keeps window ids while the app is quitting", () => {
    expect(
      nextWindowIDsAfterClosed({
        ids: ["window-a", "window-b"],
        closed: "window-a",
        remaining: 1,
        appQuitting: true,
      }),
    ).toEqual(["window-a", "window-b"])
  })
})

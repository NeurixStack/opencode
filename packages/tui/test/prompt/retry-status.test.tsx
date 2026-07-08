/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { PromptInterruptHint, PromptRetryStatus } from "../../src/component/prompt/retry-status"
import { RGBA } from "@opentui/core"
import type { Theme } from "../../src/theme"

function RetryRow() {
  const theme = {
    error: RGBA.fromInts(255, 0, 0, 255),
    primary: RGBA.fromInts(255, 255, 255, 255),
    text: RGBA.fromInts(255, 255, 255, 255),
    textMuted: RGBA.fromInts(128, 128, 128, 255),
  } as Theme
  return (
    <box width="100%" flexDirection="row" gap={1}>
      <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} justifyContent="space-between">
        <box flexShrink={1} flexDirection="row" gap={1}>
          <box marginLeft={1} flexShrink={0}>
            <text>[⋯]</text>
          </box>
          <box flexDirection="row" gap={1} flexShrink={1}>
            <PromptRetryStatus
              status={{ type: "retry", message: "Too Many Requests", attempt: 10, next: Date.now() + 824_000 }}
              theme={theme}
              dialog={{} as never}
            />
          </box>
        </box>
      </box>
      <PromptInterruptHint armed={false} theme={theme} />
    </box>
  )
}

test("retry status keeps the interrupt hint on one line", async () => {
  const app = await testRender(() => <RetryRow />, { width: 50, height: 4 })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()

    expect(frame).toContain("Too Many Reque")
    expect(frame).toContain("esc interrupt")
    expect(frame.split("\n").filter((line) => line.trim()).length).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

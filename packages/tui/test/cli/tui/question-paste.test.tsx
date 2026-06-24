/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { QuestionPrompt } from "../../../src/routes/session/question"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("pasting while selecting starts a custom answer", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const request = {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        header: "Approach",
        question: "How should this be implemented?",
        options: [{ label: "Suggested", description: "Use the suggested approach" }],
      },
    ],
  } satisfies QuestionRequest

  function Harness() {
    const renderer = useRenderer()
    const config = createTuiResolvedConfig()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={tmp.path} paths={{ state }}>
        <SDKProvider url="http://test" events={{ subscribe: async () => () => {} }}>
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={config}>
              <KVProvider>
                <ThemeProvider mode="dark">
                  <QuestionPrompt request={request} />
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </SDKProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20 })
  try {
    await wait(() => app.captureCharFrame().includes("How should this be implemented?"))
    await app.mockInput.pasteBracketedText("Use the existing state machine")
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)

    const textarea = app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused custom answer textarea")
    expect(textarea.plainText).toBe("Use the existing state machine")
  } finally {
    app.renderer.destroy()
  }
})

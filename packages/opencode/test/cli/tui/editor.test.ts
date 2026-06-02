import { afterEach, expect, mock, test } from "bun:test"
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { errorMessage } from "../../../src/util/error"
import { tmpdir } from "../../fixture/fixture"

const originalVisual = process.env.VISUAL
const originalEditor = process.env.EDITOR
const systemOpened: string[] = []
const retained = new Set<string>()
let systemOpenError: Error | undefined

void mock.module("open", () => ({
  default: async (filepath: string) => {
    if (systemOpenError) throw systemOpenError
    systemOpened.push(filepath)
  },
}))

const Editor = await import("../../../src/cli/cmd/tui/util/editor")

afterEach(async () => {
  if (originalVisual === undefined) delete process.env.VISUAL
  else process.env.VISUAL = originalVisual
  if (originalEditor === undefined) delete process.env.EDITOR
  else process.env.EDITOR = originalEditor
  systemOpened.length = 0
  systemOpenError = undefined
  await Promise.all([...retained].map((dir) => rm(dir, { force: true, recursive: true })))
  retained.clear()
})

function renderer() {
  const events: string[] = []
  return {
    events,
    value: {
      suspend() {
        events.push("suspend")
      },
      currentRenderBuffer: {
        clear() {
          events.push("clear")
        },
      },
      resume() {
        events.push("resume")
      },
      requestRender() {
        events.push("render")
      },
    } as unknown as CliRenderer,
  }
}

async function editor(dir: string, name: string, source: string) {
  const filepath = join(dir, `${name}.ts`)
  await Bun.write(filepath, source)
  return `${process.execPath} ${filepath}`
}

test("open returns without suspending the renderer when no editor is configured", async () => {
  delete process.env.VISUAL
  delete process.env.EDITOR
  const render = renderer()

  expect(await Editor.open({ value: "secret", renderer: render.value, cwd: process.cwd() })).toBeUndefined()
  expect(render.events).toEqual([])
})

test("openFile prefers VISUAL and separates file resolution from editor cwd", async () => {
  await using directory = await tmpdir()
  await using cwd = await tmpdir()
  const target = join(directory.path, "target.md")
  const marker = join(directory.path, "marker.txt")
  await Bun.write(target, "target")
  process.env.VISUAL = await editor(
    directory.path,
    "visual",
    `await Bun.write(${JSON.stringify(marker)}, process.cwd() + "\\n" + process.argv.at(-1))`,
  )
  process.env.EDITOR = await editor(directory.path, "editor", "process.exit(7)")
  const render = renderer()

  await Editor.openFile({ filepath: "target.md", renderer: render.value, cwd: cwd.path, directory: directory.path })

  expect(await Bun.file(marker).text()).toBe(`${cwd.path}\n${target}`)
  expect(render.events).toEqual(["suspend", "clear", "clear", "resume", "render"])
})

test("openFile falls back to EDITOR when VISUAL is empty", async () => {
  await using tmp = await tmpdir()
  const target = join(tmp.path, "target.md")
  const marker = join(tmp.path, "marker.txt")
  await Bun.write(target, "target")
  process.env.VISUAL = ""
  process.env.EDITOR = await editor(
    tmp.path,
    "editor",
    `await Bun.write(${JSON.stringify(marker)}, process.argv.at(-1)!)`,
  )

  await Editor.openFile({ filepath: target, renderer: renderer().value, cwd: tmp.path, directory: tmp.path })

  expect(await Bun.file(marker).text()).toBe(target)
})

test("open returns empty edited content and removes its draft", async () => {
  await using tmp = await tmpdir()
  const marker = join(tmp.path, "marker.txt")
  process.env.VISUAL = await editor(
    tmp.path,
    "editor",
    `const filepath = process.argv.at(-1)!; await Bun.write(${JSON.stringify(marker)}, filepath); await Bun.write(filepath, "")`,
  )

  expect(await Editor.open({ value: "draft", renderer: renderer().value, cwd: tmp.path })).toBe("")
  expect(await draftExists(marker)).toBeFalse()
})

test("openTemporary removes drafts after blocking editors exit", async () => {
  await using tmp = await tmpdir()
  const marker = join(tmp.path, "marker.txt")
  process.env.VISUAL = await editor(
    tmp.path,
    "editor",
    `await Bun.write(${JSON.stringify(marker)}, process.argv.at(-1)!)`,
  )

  await Editor.openTemporary({ value: "transcript", renderer: renderer().value, cwd: tmp.path })

  expect(await draftExists(marker)).toBeFalse()
})

test("openTemporary retains drafts opened by the platform application", async () => {
  delete process.env.VISUAL
  delete process.env.EDITOR

  await Editor.openTemporary({ value: "transcript", renderer: renderer().value, cwd: process.cwd() })

  expect(systemOpened).toHaveLength(1)
  const filepath = systemOpened[0]
  expect(filepath).toBeDefined()
  if (!filepath) return
  retained.add(dirname(filepath))
  expect(await Bun.file(filepath).text()).toBe("transcript")
})

test("openFile uses the platform application when no editor is configured", async () => {
  await using tmp = await tmpdir()
  delete process.env.VISUAL
  delete process.env.EDITOR
  const target = join(tmp.path, "target.md")
  await Bun.write(target, "target")

  await Editor.openFile({ filepath: "target.md", renderer: renderer().value, cwd: tmp.path, directory: tmp.path })

  expect(systemOpened).toEqual([target])
})

test("openFile suggests configuring an editor when the platform application fails", async () => {
  await using tmp = await tmpdir()
  delete process.env.VISUAL
  delete process.env.EDITOR
  systemOpenError = new Error("spawn xdg-open ENOENT")

  const message = await Editor.openFile({
    filepath: "target.md",
    renderer: renderer().value,
    cwd: tmp.path,
    directory: tmp.path,
  })
    .then(() => undefined)
    .catch(errorMessage)

  expect(message).toBe("Failed to open file: spawn xdg-open ENOENT. Set $VISUAL or $EDITOR.")
})

test("openFile restores the renderer when the editor exits unsuccessfully", async () => {
  await using tmp = await tmpdir()
  process.env.VISUAL = await editor(tmp.path, "editor", "process.exit(7)")
  const target = join(tmp.path, "target.md")
  await Bun.write(target, "target")
  const render = renderer()

  const message = await Editor.openFile({
    filepath: target,
    renderer: render.value,
    cwd: tmp.path,
    directory: tmp.path,
  })
    .then(() => undefined)
    .catch(errorMessage)
  expect(message).toBe(
    `Failed to open file with ${process.execPath} ${join(tmp.path, "editor.ts")}: Editor exited with code 7. Check $VISUAL or $EDITOR.`,
  )
  expect(render.events).toEqual(["suspend", "clear", "clear", "resume", "render"])
})

async function draftExists(marker: string) {
  return Bun.file(await Bun.file(marker).text()).exists()
}

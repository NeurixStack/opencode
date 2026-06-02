import { defer } from "@/util/defer"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import systemOpen from "open"

export async function open(opts: { value: string; renderer: CliRenderer; cwd: string }): Promise<string | undefined> {
  const editor = configuredEditor()
  if (!editor) return

  const draft = await createDraft(opts.value)
  await using _ = defer(draft.remove)
  await openEditor(draft.filepath, opts, editor)
  return Filesystem.readText(draft.filepath)
}

export async function openTemporary(opts: { value: string; renderer: CliRenderer; cwd: string }) {
  const draft = await createDraft(opts.value)
  const mode = await openPath(draft.filepath, opts).catch(async (error) => {
    await draft.remove()
    throw error
  })
  // System openers detach, so retain the draft in the OS temp dir for the application to read.
  if (mode === "system") return
  await draft.remove()
}

export async function openFile(opts: { filepath: string; renderer: CliRenderer; cwd: string; directory: string }) {
  await openPath(Filesystem.resolveFilePath(opts.directory, opts.filepath), opts)
}

async function createDraft(value: string) {
  const dir = await mkdtemp(join(tmpdir(), "opencode-editor-"))
  const filepath = join(dir, "draft.md")
  await Filesystem.write(filepath, value).catch(async (error) => {
    await rm(dir, { force: true, recursive: true })
    throw error
  })
  return {
    filepath,
    remove: () => rm(dir, { force: true, recursive: true }),
  }
}

async function openPath(filepath: string, opts: { renderer: CliRenderer; cwd: string }) {
  const editor = configuredEditor()
  if (editor) {
    await openEditor(filepath, opts, editor).catch((error) => {
      throw new Error(`Failed to open file with ${editor}: ${errorMessage(error)}. Check $VISUAL or $EDITOR.`)
    })
    return "editor" as const
  }
  await systemOpen(filepath).catch((error) => {
    throw new Error(`Failed to open file: ${errorMessage(error)}. Set $VISUAL or $EDITOR.`)
  })
  return "system" as const
}

function configuredEditor() {
  return process.env["VISUAL"]?.trim() || process.env["EDITOR"]?.trim()
}

async function openEditor(filepath: string, opts: { renderer: CliRenderer; cwd: string }, editor: string) {
  opts.renderer.suspend()
  opts.renderer.currentRenderBuffer.clear()
  try {
    const parts = editor.split(/\s+/)
    const proc = Process.spawn([...parts, filepath], {
      cwd: opts.cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      shell: process.platform === "win32",
    })
    const code = await proc.exited
    if (code !== 0) throw new Error(`Editor exited with code ${code}`)
  } finally {
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()
  }
}

export * as Editor from "./editor"

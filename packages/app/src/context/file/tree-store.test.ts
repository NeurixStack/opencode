import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createFileTreeStore } from "./tree-store"

describe("file tree store", () => {
  test("expands synthetic directories without listing them", () => {
    const listed: string[] = []
    const value = createRoot((dispose) => ({
      dispose,
      tree: createFileTreeStore({
        scope: () => "/project",
        normalizeDir: (input) => input,
        list: (input) => {
          listed.push(input)
          return Promise.resolve([])
        },
        onError: () => undefined,
      }),
    }))

    value.tree.expandDir("deleted/parent", { load: false })

    expect(value.tree.dirState("deleted/parent")?.expanded).toBe(true)
    expect(listed).toEqual([])

    value.dispose()
  })
})

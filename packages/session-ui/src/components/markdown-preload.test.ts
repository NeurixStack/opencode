import { expect, test } from "bun:test"
import { getCachedMarkdownCode, preloadMarkdown, touchCachedMarkdownCode } from "./markdown-cache"

test("preloads completed markdown into the render cache", async () => {
  const parsed: string[] = []
  const parser = {
    parse(text: string) {
      parsed.push(text)
      return `<p>${text}</p>`
    },
  }
  const key = `markdown-preload-${crypto.randomUUID()}`

  await preloadMarkdown("prepared response", key, parser)
  await preloadMarkdown("prepared response", key, parser)

  expect(parsed).toEqual(["prepared response"])
})

test("keeps completed code highlights by stable block key", () => {
  const key = `markdown-code-${crypto.randomUUID()}:0:code`
  touchCachedMarkdownCode(key, {
    raw: "```ts\nconst value = 1\n```",
    hash: "23",
    language: "ts",
    generation: 1,
    stable: [["const", "color: red"]],
    unstable: [],
  })

  expect(getCachedMarkdownCode(key)).toEqual({
    raw: "```ts\nconst value = 1\n```",
    hash: "23",
    language: "ts",
    generation: 1,
    stable: [["const", "color: red"]],
    unstable: [],
  })
})

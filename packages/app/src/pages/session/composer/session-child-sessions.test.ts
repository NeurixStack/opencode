import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { childSessionTitle, listChildSessions } from "./session-child-sessions"

const session = (input: { id: string; parentID?: string; updated?: number; title?: string; agent?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    title: input.title ?? input.id,
    agent: input.agent,
    time: { created: 1, updated: input.updated ?? 1 },
  }) as Session

describe("child session picker", () => {
  test("lists siblings from a root or child session", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "first", parentID: "root" }),
      session({ id: "second", parentID: "root" }),
      session({ id: "nested", parentID: "first" }),
    ]

    expect(listChildSessions({ sessions, currentID: "root", working: () => false }).map((item) => item.id)).toEqual([
      "second",
      "first",
    ])
    expect(listChildSessions({ sessions, currentID: "first", working: () => false }).map((item) => item.id)).toEqual([
      "second",
      "first",
    ])
  })

  test("sorts running sessions first and newest sessions within each group", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "old-idle", parentID: "root", updated: 1 }),
      session({ id: "new-idle", parentID: "root", updated: 4 }),
      session({ id: "old-running", parentID: "root", updated: 2 }),
      session({ id: "new-running", parentID: "root", updated: 3 }),
    ]
    const running = new Set(["old-running", "new-running"])

    expect(
      listChildSessions({ sessions, currentID: "root", working: (id) => running.has(id) }).map((item) => item.id),
    ).toEqual(["new-running", "old-running", "new-idle", "old-idle"])
  })

  test("removes the generated subagent suffix from descriptions", () => {
    expect(
      childSessionTitle(session({ id: "child", title: "Inspect the composer (@explore subagent)", agent: "explore" })),
    ).toBe("Inspect the composer")
  })
})

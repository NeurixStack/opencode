import { describe, expect, test } from "bun:test"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  estimateRootSessionTotal,
  loadRootSessionsWithFallback,
  mergeRootSessionLoad,
} from "./global-sync/session-load"

function session(input: {
  id: string
  directory?: string
  created?: number
  updated?: number
  parentID?: string
  archived?: number
}) {
  return {
    id: input.id,
    directory: input.directory ?? "/repo",
    projectID: "project",
    title: input.id,
    parentID: input.parentID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: input.created ?? 1_000,
      updated: input.updated ?? input.created ?? 1_000,
      archived: input.archived,
    },
  } as Session
}

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10 }])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25 },
      { directory: "dir", roots: true },
    ])
  })
})

describe("mergeRootSessionLoad", () => {
  test("keeps sessions created while a stale list request was in flight", () => {
    const result = mergeRootSessionLoad({
      directory: "/repo",
      loadedAt: 2_000,
      listed: [],
      current: [session({ id: "new", created: 2_100 })],
      limit: 5,
      permission: {},
    })

    expect(result.map((item) => item.id)).toEqual(["new"])
  })

  test("keeps newer live session data over stale list responses", () => {
    const result = mergeRootSessionLoad({
      directory: "/repo",
      loadedAt: 2_000,
      listed: [session({ id: "same", updated: 1_500 })],
      current: [{ ...session({ id: "same", updated: 2_100 }), title: "new title" }],
      limit: 5,
      permission: {},
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("new title")
  })

  test("allows authoritative loads to remove old missing roots", () => {
    const result = mergeRootSessionLoad({
      directory: "/repo",
      loadedAt: 2_000,
      listed: [],
      current: [session({ id: "old", updated: 1_500 })],
      limit: 5,
      permission: {},
    })

    expect(result).toEqual([])
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})

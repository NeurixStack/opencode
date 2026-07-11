import { expect, test } from "bun:test"
import type { SessionMessageInfo, SessionPendingInfo } from "@opencode-ai/sdk/v2"
import {
  applyTimelineOperations,
  fromPending,
  visibleMessages,
  type SessionTimelineInput,
} from "../../src/context/session-timeline"

test("orders promoted work, compaction, steers, then queued inputs", () => {
  const inputs = [
    pending("queue", 0, "queue"),
    pending("steer-2", 3, "steer"),
    fromPending({ admittedSeq: 2, id: "compaction", sessionID: "session", timeCreated: 2, type: "compaction" }),
    pending("steer-1", 1, "steer"),
  ]

  const result = applyTimelineOperations(inputs, [
    { type: "promoted", inputID: "steer-2", promotedSeq: 4, created: 4 },
  ])

  expect(result.map((input) => input.id)).toEqual(["steer-2", "compaction", "steer-1", "queue"])
})

test("replays an admission after the pending snapshot", () => {
  const input = pending("late", 2, "steer")
  expect(applyTimelineOperations([], [{ type: "admitted", input }])).toEqual([input])
})

test("does not let late admission downgrade a promotion", () => {
  const input = pending("input", 1, "steer")
  const result = applyTimelineOperations([], [
    { type: "admitted", input },
    { type: "promoted", inputID: input.id, promotedSeq: 2, created: 2 },
    { type: "admitted", input },
  ])

  expect(result).toMatchObject([{ id: input.id, phase: "promoted", promotedSeq: 2 }])
})

test("retains promotion state until a later admission provides content", () => {
  const input = pending("input", 1, "steer")
  const result = applyTimelineOperations([], [
    { type: "promoted", inputID: input.id, promotedSeq: 2, created: 2 },
    { type: "admitted", input },
  ])

  expect(result).toMatchObject([{ id: input.id, phase: "promoted", promotedSeq: 2, message: { text: "input" } }])
})

test("applies committed reverts after a stale pending snapshot", () => {
  const inputs = [pending("msg_001", 1, "steer"), pending("msg_002", 2, "queue")]
  expect(applyTimelineOperations(inputs, [{ type: "reverted", to: "msg_002" }]).map((input) => input.id)).toEqual([
    "msg_001",
  ])
})

test("projected messages replace pending and promoted representations", () => {
  const projected: SessionMessageInfo[] = [{ id: "input", type: "user", text: "hello", time: { created: 2 } }]
  const inputs = applyTimelineOperations(
    [pending("input", 1, "steer")],
    [{ type: "promoted", inputID: "input", promotedSeq: 2, created: 2 }],
    new Set(["input"]),
  )

  expect(inputs).toEqual([])
  expect(visibleMessages(projected, [pending("input", 1, "steer")])).toEqual(projected)
})

function pending(id: string, admittedSeq: number, delivery: "steer" | "queue"): SessionTimelineInput {
  return fromPending({
    admittedSeq,
    id,
    sessionID: "session",
    timeCreated: admittedSeq,
    type: "user",
    data: { text: id },
    delivery,
  } satisfies SessionPendingInfo)
}

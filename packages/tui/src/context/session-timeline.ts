import type { SessionMessageInfo, SessionPendingInfo } from "@opencode-ai/sdk/v2"

export type SessionPendingWork =
  | {
      kind: "message"
      id: string
      phase: "pending" | "promoted"
      admittedSeq: number
      promotedSeq?: number
      delivery: "steer" | "queue"
      message?: SessionMessageInfo
    }
  | {
      kind: "compaction"
      id: string
      phase: "pending"
      admittedSeq: number
    }

export type SessionTimelineOperation =
  | { type: "admitted"; work: SessionPendingWork }
  | { type: "promoted"; inputID: string; promotedSeq: number; created: number }
  | { type: "removed"; inputID: string }
  | { type: "reverted"; to: string }

export function fromAdmission(input: {
  id: string
  admittedSeq: number
  timeCreated: number
  input:
    | { type: "user"; data: Extract<SessionPendingInfo, { type: "user" }>["data"]; delivery: "steer" | "queue" }
    | {
        type: "synthetic"
        data: Extract<SessionPendingInfo, { type: "synthetic" }>["data"]
        delivery: "steer" | "queue"
      }
}): SessionPendingWork {
  return {
    kind: "message",
    id: input.id,
    phase: "pending",
    admittedSeq: input.admittedSeq,
    delivery: input.input.delivery,
    message: {
      id: input.id,
      type: input.input.type,
      ...input.input.data,
      time: { created: input.timeCreated },
    },
  }
}

export function fromPending(item: SessionPendingInfo): SessionPendingWork {
  if (item.type === "user")
    return {
      kind: "message",
      id: item.id,
      phase: "pending",
      admittedSeq: item.admittedSeq,
      delivery: item.delivery,
      message: {
        id: item.id,
        type: "user",
        ...item.data,
        time: { created: item.timeCreated },
      },
    }
  if (item.type === "synthetic")
    return {
      kind: "message",
      id: item.id,
      phase: "pending",
      admittedSeq: item.admittedSeq,
      delivery: item.delivery,
      message: {
        id: item.id,
        type: "synthetic",
        ...item.data,
        time: { created: item.timeCreated },
      },
    }
  return {
    kind: "compaction",
    id: item.id,
    phase: "pending",
    admittedSeq: item.admittedSeq,
  }
}

export function applyTimelineOperations(
  pending: SessionPendingWork[],
  operations: SessionTimelineOperation[],
  projectedIDs = new Set<string>(),
) {
  const result = new Map(pending.filter((work) => !projectedIDs.has(work.id)).map((work) => [work.id, work]))
  operations.forEach((operation) => {
    if (operation.type === "reverted") {
      result.forEach((_, id) => {
        if (id >= operation.to) result.delete(id)
      })
      return
    }
    if (operation.type === "removed") {
      result.delete(operation.inputID)
      return
    }
    if (projectedIDs.has(operation.type === "admitted" ? operation.work.id : operation.inputID)) return
    if (operation.type === "admitted") {
      const existing = result.get(operation.work.id)
      if (operation.work.kind === "compaction") {
        result.set(operation.work.id, existing ?? operation.work)
        return
      }
      result.set(
        operation.work.id,
        existing?.kind === "message" && existing.phase === "promoted"
          ? { ...operation.work, phase: "promoted", promotedSeq: existing.promotedSeq }
          : (existing ?? operation.work),
      )
      return
    }
    const existing = result.get(operation.inputID)
    result.set(operation.inputID, {
      ...(existing?.kind === "message" ? existing : undefined),
      kind: "message",
      id: operation.inputID,
      phase: "promoted",
      admittedSeq: existing?.admittedSeq ?? operation.promotedSeq,
      promotedSeq: operation.promotedSeq,
      delivery: existing?.kind === "message" ? existing.delivery : "steer",
      message: existing?.kind === "message" && existing.message
        ? {
            ...existing.message,
            time: { ...existing.message.time, created: operation.created },
          }
        : undefined,
    })
  })
  return orderInputs([...result.values()])
}

export function visibleMessages(projected: SessionMessageInfo[], pending: SessionPendingWork[]) {
  if (pending.length === 0) return projected
  const ids = new Set(projected.map((message) => message.id))
  return [
    ...projected,
    ...pending.flatMap((work) => (work.kind === "message" && !ids.has(work.id) && work.message ? [work.message] : [])),
  ]
}

export function pendingCompactions(pending: SessionPendingWork[]) {
  return pending.flatMap((work) => (work.kind === "compaction" ? [work.id] : []))
}

function orderInputs(pending: SessionPendingWork[]) {
  const bucket = (work: SessionPendingWork) => {
    if (work.kind === "message" && work.phase === "promoted") return 0
    if (work.kind === "compaction") return 1
    if (work.delivery === "steer") return 2
    return 3
  }
  return pending.toSorted(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (a.kind === "message" && a.phase === "promoted" && b.kind === "message"
        ? (a.promotedSeq ?? a.admittedSeq) - (b.promotedSeq ?? b.admittedSeq)
        : 0) ||
      a.admittedSeq - b.admittedSeq,
  )
}

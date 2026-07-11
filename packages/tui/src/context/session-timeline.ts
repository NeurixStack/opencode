import type { SessionMessageInfo, SessionPendingInfo } from "@opencode-ai/sdk/v2"

export type SessionTimelineWork =
  | {
      kind: "input"
      id: string
      admittedSeq: number
      delivery: "steer" | "queue"
      message: SessionMessageInfo
    }
  | {
      kind: "promoted"
      id: string
      promotedSeq: number
      message?: SessionMessageInfo
    }
  | {
      kind: "compaction"
      id: string
      admittedSeq: number
    }

export type SessionAdmittedWork = Exclude<SessionTimelineWork, { kind: "promoted" }>

export type SessionTimelineOperation =
  | { type: "admitted"; work: SessionAdmittedWork }
  | { type: "promoted"; inputID: string; promotedSeq: number; created: number }
  | { type: "removed"; inputID: string }
  | { type: "reverted"; to: string }

export function fromPending(item: SessionPendingInfo): SessionAdmittedWork {
  if (item.type === "user")
    return {
      kind: "input",
      id: item.id,
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
      kind: "input",
      id: item.id,
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
    admittedSeq: item.admittedSeq,
  }
}

export function applyTimelineOperations(
  pending: SessionTimelineWork[],
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
        existing?.kind === "promoted"
          ? { ...existing, message: existing.message ?? operation.work.message }
          : (existing ?? operation.work),
      )
      return
    }
    const existing = result.get(operation.inputID)
    result.set(operation.inputID, {
      kind: "promoted",
      id: operation.inputID,
      promotedSeq: operation.promotedSeq,
      message: existing?.kind === "input"
        ? {
            ...existing.message,
            time: { ...existing.message.time, created: operation.created },
          }
        : undefined,
    })
  })
  return orderInputs([...result.values()])
}

export function visibleMessages(projected: SessionMessageInfo[], pending: SessionTimelineWork[]) {
  if (pending.length === 0) return projected
  const ids = new Set(projected.map((message) => message.id))
  return [
    ...projected,
    ...pending.flatMap((work) =>
      work.kind !== "compaction" && !ids.has(work.id) && work.message ? [work.message] : [],
    ),
  ]
}

export function pendingCompactions(pending: SessionTimelineWork[]) {
  return pending.flatMap((work) => (work.kind === "compaction" ? [work.id] : []))
}

function orderInputs(pending: SessionTimelineWork[]) {
  const bucket = (work: SessionTimelineWork) => {
    if (work.kind === "promoted") return 0
    if (work.kind === "compaction") return 1
    if (work.delivery === "steer") return 2
    return 3
  }
  const sequence = (work: SessionTimelineWork) =>
    work.kind === "promoted" ? work.promotedSeq : work.admittedSeq
  return pending.toSorted((a, b) => bucket(a) - bucket(b) || sequence(a) - sequence(b))
}

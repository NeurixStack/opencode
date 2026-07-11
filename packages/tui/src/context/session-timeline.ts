import type { SessionMessageInfo, SessionPendingInfo } from "@opencode-ai/sdk/v2"

export type SessionTimelineInput = {
  id: string
  phase: "pending" | "promoted"
  admittedSeq: number
  promotedSeq?: number
  delivery?: "steer" | "queue"
  message?: SessionMessageInfo
}

export type SessionTimelineOperation =
  | { type: "admitted"; input: SessionTimelineInput }
  | { type: "promoted"; inputID: string; promotedSeq: number; created: number }
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
}): SessionTimelineInput {
  return {
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

export function fromPending(item: SessionPendingInfo): SessionTimelineInput {
  if (item.type === "user")
    return {
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
    id: item.id,
    phase: "pending",
    admittedSeq: item.admittedSeq,
    message: {
      id: item.id,
      type: "compaction",
      status: "running",
      reason: "manual",
      summary: "",
      recent: "",
      time: { created: item.timeCreated },
    },
  }
}

export function applyTimelineOperations(
  inputs: SessionTimelineInput[],
  operations: SessionTimelineOperation[],
  projectedIDs = new Set<string>(),
) {
  const result = new Map(inputs.filter((input) => !projectedIDs.has(input.id)).map((input) => [input.id, input]))
  operations.forEach((operation) => {
    if (operation.type === "reverted") {
      result.forEach((_, id) => {
        if (id >= operation.to) result.delete(id)
      })
      return
    }
    if (projectedIDs.has(operation.type === "admitted" ? operation.input.id : operation.inputID)) return
    if (operation.type === "admitted") {
      const existing = result.get(operation.input.id)
      result.set(
        operation.input.id,
        existing?.phase === "promoted"
          ? { ...operation.input, phase: "promoted", promotedSeq: existing.promotedSeq }
          : (existing ?? operation.input),
      )
      return
    }
    const existing = result.get(operation.inputID)
    result.set(operation.inputID, {
      ...existing,
      id: operation.inputID,
      phase: "promoted",
      admittedSeq: existing?.admittedSeq ?? operation.promotedSeq,
      promotedSeq: operation.promotedSeq,
      message: existing?.message
        ? {
            ...existing.message,
            time: { ...existing.message.time, created: operation.created },
          }
        : undefined,
    })
  })
  return orderInputs([...result.values()])
}

export function visibleMessages(projected: SessionMessageInfo[], inputs: SessionTimelineInput[]) {
  if (inputs.length === 0) return projected
  const ids = new Set(projected.map((message) => message.id))
  return [
    ...projected,
    ...inputs.filter((input) => !ids.has(input.id)).flatMap((input) => (input.message ? [input.message] : [])),
  ]
}

function orderInputs(inputs: SessionTimelineInput[]) {
  const bucket = (input: SessionTimelineInput) => {
    if (input.phase === "promoted") return 0
    if (input.message?.type === "compaction") return 1
    if (input.delivery === "steer") return 2
    return 3
  }
  return inputs.toSorted(
    (a, b) =>
      bucket(a) - bucket(b) ||
      (a.phase === "promoted" ? (a.promotedSeq ?? a.admittedSeq) - (b.promotedSeq ?? b.admittedSeq) : 0) ||
      a.admittedSeq - b.admittedSeq,
  )
}

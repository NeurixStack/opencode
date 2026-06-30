const subagentTools = new Set(["subagent", "task"])

type SubagentDisplayStateInput = {
  readonly toolStatus: string
  readonly metadata: Record<string, unknown>
  readonly sessionStatus: (sessionID: string) => string
}

type SessionSummary = {
  readonly id: string
  readonly parentID?: string
  readonly title?: string
}

type TimelinePart = {
  readonly type: string
  readonly name?: string
  readonly state?: {
    readonly status: string
    readonly input?: unknown
    readonly structured?: Record<string, unknown>
  }
}

type TimelineMessage = {
  readonly type: string
  readonly content?: readonly TimelinePart[]
}

export function foregroundSubagentCount(input: {
  readonly sessionID?: string
  readonly sessions: readonly SessionSummary[]
  readonly messages: readonly TimelineMessage[]
  readonly status: (sessionID: string) => string
}) {
  if (!input.sessionID) return 0

  const backgrounded = new Set(
    input.messages.flatMap((message) =>
      message.type === "assistant"
        ? (message.content ?? []).flatMap((part) => {
            if (part.type !== "tool") return []
            if (!part.name || !subagentTools.has(part.name)) return []
            if (part.state?.status === "pending" || part.state?.structured?.background !== true) return []
            const sessionID =
              typeof part.state.structured.sessionID === "string"
                ? part.state.structured.sessionID
                : typeof part.state.structured.sessionId === "string"
                  ? part.state.structured.sessionId
                  : undefined
            return sessionID ? [sessionID] : []
          })
        : [],
    ),
  )

  const runningSessionIDs = new Set(
    input.sessions
      .filter(
        (session) =>
          session.parentID === input.sessionID &&
          input.status(session.id) === "running" &&
          !backgrounded.has(session.id),
      )
      .map((session) => session.id),
  )

  const runningSessionTitles = new Set(
    input.sessions
      .filter((session) => runningSessionIDs.has(session.id) && session.title)
      .map((session) => session.title),
  )

  const runningRows = input.messages.flatMap((message) =>
    message.type === "assistant"
      ? (message.content ?? []).filter(
          (part) =>
            part.type === "tool" &&
            part.name !== undefined &&
            subagentTools.has(part.name) &&
            part.state?.status === "running" &&
            part.state.structured?.background !== true,
        )
      : [],
  )

  const runningRowSessionIDs = new Set(
    runningRows.flatMap((part) => {
      const sessionID = subagentSessionID(part.state?.structured ?? {})
      return sessionID ? [sessionID] : []
    }),
  )

  const anonymousRunningRows = runningRows.filter((part) => {
    if (subagentSessionID(part.state?.structured ?? {})) return false
    const input = part.state?.input
    if (typeof input !== "object" || input === null || Array.isArray(input) || !("description" in input)) return true
    return typeof input.description === "string" ? !runningSessionTitles.has(input.description) : true
  }).length

  const runningSessions = [...runningSessionIDs].filter((session) => !runningRowSessionIDs.has(session)).length

  return runningSessions + runningRowSessionIDs.size + anonymousRunningRows
}

export function subagentDisplayState(input: SubagentDisplayStateInput) {
  const sessionID = subagentSessionID(input.metadata)
  const background = input.metadata.background === true
  const childRunning = background && sessionID !== undefined && input.sessionStatus(sessionID) === "running"
  const running = input.toolStatus === "running" || childRunning
  return {
    background,
    running,
    icon: running ? "│" : "✓",
  }
}

function subagentSessionID(metadata: Record<string, unknown>) {
  if (typeof metadata.sessionID === "string") return metadata.sessionID
  if (typeof metadata.sessionId === "string") return metadata.sessionId
  return undefined
}

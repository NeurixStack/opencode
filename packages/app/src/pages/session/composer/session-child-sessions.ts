import type { Session } from "@opencode-ai/sdk/v2"

export function listChildSessions(input: {
  sessions: Session[]
  currentID?: string
  working: (sessionID: string) => boolean
}) {
  const current = input.currentID ? input.sessions.find((session) => session.id === input.currentID) : undefined
  const parentID = current?.parentID ?? current?.id
  if (!parentID) return []

  return input.sessions
    .filter((session) => session.parentID === parentID)
    .toSorted((a, b) => {
      const running = Number(input.working(b.id)) - Number(input.working(a.id))
      if (running !== 0) return running
      if (a.time.updated !== b.time.updated) return b.time.updated - a.time.updated
      return b.id.localeCompare(a.id)
    })
}

export function childSessionTitle(session: Session) {
  return session.title.replace(/\s+\(@[^)]+ subagent\)$/, "") || session.title
}

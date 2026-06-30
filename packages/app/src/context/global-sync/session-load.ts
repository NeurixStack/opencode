import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { sessionUpdatedAt, trimSessions } from "./session-trim"
import type { RootLoadArgs } from "./types"
import { directoryKey } from "./utils"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}

export function mergeRootSessionLoad(input: {
  directory: string
  loadedAt: number
  listed: Session[]
  current: Session[]
  limit: number
  permission: Record<string, PermissionRequest[]>
}) {
  const directory = directoryKey(input.directory)
  const currentRoots = input.current.filter(
    (session) => !session.parentID && !session.time?.archived && directoryKey(session.directory) === directory,
  )
  const byID = new Map(
    input.listed
      .filter((session) => !!session?.id)
      .filter((session) => !session.time?.archived)
      .map((session) => [session.id, session] as const),
  )

  // A list response can resolve after live create/update events have already seeded this store.
  for (const session of currentRoots) {
    const listed = byID.get(session.id)
    if (!listed) {
      if (sessionUpdatedAt(session) >= input.loadedAt) byID.set(session.id, session)
      continue
    }
    if (sessionUpdatedAt(session) >= input.loadedAt && sessionUpdatedAt(session) > sessionUpdatedAt(listed)) {
      byID.set(session.id, session)
    }
  }

  return trimSessions([...byID.values(), ...input.current.filter((session) => !!session.parentID)], {
    limit: input.limit,
    permission: input.permission,
  })
}

import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"

// Reactive session lineage for the target session route, read from the sync store.
// All session tabs on a server share one route instance, so the target session ID
// changes in place; the effect is only a trigger that starts resolution for the
// current target, and each run cancels the previous one through onCleanup so a
// late result from an abandoned target is dropped. Resolution is imperative rather
// than a resource on purpose: a resource created here would be created inside the
// router's navigation transition, and suspending that transition deadlocks the URL
// commit and double-mounts the session header portals from the transition's shadow
// render.
//
// The returned accessor is a pure derivation. The sync cache is authoritative, and
// status only applies while it matches the current target: on navigation the memo
// re-evaluates before the trigger runs, so trusting a previous target's settlement
// would fabricate a not-found for a session that simply has not resolved yet.
// Resolve failures rethrow on read so the enclosing SessionRouteErrorBoundary
// renders the scoped session error.
export function createSessionLineage<T>(
  sessionID: () => string,
  lineage: () => { peek: (id: string) => T | undefined; resolve: (id: string) => Promise<unknown> },
) {
  const cached = createMemo(() => lineage().peek(sessionID()))
  const [status, setStatus] = createSignal<{ id: string; settled: boolean; failure?: unknown }>()

  createEffect(
    on(sessionID, (id) => {
      let stale = false
      onCleanup(() => {
        stale = true
      })
      if (cached()) {
        setStatus({ id, settled: true })
        return
      }
      setStatus({ id, settled: false })
      lineage()
        .resolve(id)
        .then(() => {
          if (!stale) setStatus({ id, settled: true })
        })
        .catch((error) => {
          if (!stale) setStatus({ id, settled: true, failure: error })
        })
    }),
  )

  return createMemo(() => {
    const id = sessionID()
    const value = cached()
    if (value) return value
    const state = status()
    if (state?.id !== id) return undefined
    if (state.failure !== undefined) throw state.failure
    // The viewed session is pinned and pinned lineages are exempt from cache pruning,
    // so a lineage missing after settlement means the session (or an ancestor) was
    // deleted, possibly by another client. Match the resolve error so the boundary
    // shows the session not found fallback.
    if (state.settled) throw new Error(`Session not found: ${id}`)
    return undefined
  })
}

import { ErrorBoundary, Show, createComponent, createEffect, on } from "solid-js"
import type { JSX } from "solid-js"

// Structural boundary for the target session route: decides when the route
// subtree remounts and how route-level errors are scoped. Kept free of app
// contexts (and JSX) so the remount semantics can be tested directly.
//
// Keyed by server only. Workspace-scoped state (notably TerminalProvider and
// its PTY WebSockets) lives inside the route subtree, so switching session
// tabs within the same workspace must not remount it; session changes are
// handled reactively below (TargetSessionPage re-keys per workspace).
export function SessionRouteBoundary(props: {
  serverKey: string | undefined
  sessionID: string | undefined
  fallback: (error: unknown) => JSX.Element
  children: JSX.Element
}) {
  return createComponent(Show, {
    get when() {
      return props.serverKey
    },
    keyed: true,
    get children() {
      return createComponent(ErrorBoundary, {
        fallback: (error: unknown, reset: () => void) => {
          // Without a per-session remount, a stale error (e.g. session not
          // found) must clear when navigating to a different session.
          createEffect(on(() => props.sessionID, reset, { defer: true }))
          return props.fallback(error)
        },
        get children() {
          return props.children
        },
      })
    },
  })
}

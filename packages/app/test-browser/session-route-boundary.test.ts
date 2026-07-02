import { expect, test } from "bun:test"
import { createComponent, createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { SessionRouteBoundary } from "@/pages/session/route-boundary"

// Terminals (and other workspace-scoped state) live inside the route subtree,
// so switching session tabs within the same server must not remount it.
test("switching sessions on the same server does not remount the route subtree", () => {
  const [server, setServer] = createSignal("srv_1")
  const [session, setSession] = createSignal("ses_a")
  let mounts = 0
  let disposals = 0
  const Probe = () => {
    mounts += 1
    onCleanup(() => {
      disposals += 1
    })
    return null
  }

  const dispose = render(
    () =>
      createComponent(SessionRouteBoundary, {
        get serverKey() {
          return server()
        },
        get sessionID() {
          return session()
        },
        fallback: () => null,
        get children() {
          return createComponent(Probe, {})
        },
      }),
    document.createElement("div"),
  )

  const initialMounts = mounts
  expect(initialMounts).toBeGreaterThan(0)

  setSession("ses_b")
  expect(mounts).toBe(initialMounts)
  expect(disposals).toBe(0)

  setServer("srv_2")
  expect(mounts).toBeGreaterThan(initialMounts)
  expect(disposals).toBeGreaterThan(0)

  dispose()
})

// Without a per-session remount, the error boundary must clear a stale error
// (e.g. session not found) when navigating to a different session.
test("route error clears when navigating to a different session", () => {
  const [session, setSession] = createSignal("ses_a")
  const [broken, setBroken] = createSignal(true)
  const Thrower = () => {
    if (broken()) throw new Error(`Session not found: ${session()}`)
    return "content"
  }

  const container = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(SessionRouteBoundary, {
        serverKey: "srv_1",
        get sessionID() {
          return session()
        },
        fallback: () => "error-fallback",
        get children() {
          return createComponent(Thrower, {})
        },
      }),
    container,
  )

  expect(container.textContent).toBe("error-fallback")

  setBroken(false)
  setSession("ses_b")
  expect(container.textContent).toBe("content")

  dispose()
})

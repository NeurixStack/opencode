import { describe, expect, test } from "bun:test"
import Notifications from "../../../../src/feature-plugins/system/notifications"
import type { PermissionV2Request, Session, V2Event } from "@opencode-ai/sdk/v2"
import type { TuiAttentionNotifyInput } from "@opencode-ai/plugin/tui"
import { createTuiPluginApi } from "../../../fixture/tui-plugin"

async function setup() {
  const notifications: TuiAttentionNotifyInput[] = []
  const handlers = new Map<V2Event["type"], ((event: V2Event) => void)[]>()
  const session = (id: string, title: string, parentID?: string): Session => ({
    id,
    title,
    slug: id,
    projectID: "project",
    directory: "/workspace",
    ...(parentID && { parentID }),
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  })
  const sessions: Record<string, Session> = {
    session: session("session", "Demo session"),
    subagent: session("subagent", "Subagent session", "session"),
    abort: session("abort", "Abort session"),
    timeout: session("timeout", "Timeout session"),
  }

  await Notifications.tui(
    createTuiPluginApi({
      attention: {
        async notify(input) {
          notifications.push(input)
          return { ok: true, notification: true, sound: true }
        },
      },
      event: {
        on: <Type extends V2Event["type"]>(
          type: Type,
          handler: (event: Extract<V2Event, { type: Type }>) => void,
        ) => {
          const list = handlers.get(type) ?? []
          const wrapped = handler as (event: V2Event) => void
          list.push(wrapped)
          handlers.set(type, list)
          return () => {
            handlers.set(
              type,
              (handlers.get(type) ?? []).filter((item) => item !== wrapped),
            )
          }
        },
      },
      state: {
        session: {
          get: (sessionID: string) => sessions[sessionID],
        },
      },
    }),
    undefined,
    {} as never,
  )

  return {
    notifications,
    emit(event: V2Event) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
  }
}

function form(id: string, sessionID = "session"): Extract<V2Event, { type: "form.created" }>["data"]["form"] {
  return {
    id,
    sessionID,
    mode: "form",
    fields: [],
  }
}

function permission(id: string, sessionID = "session"): PermissionV2Request {
  return {
    id,
    sessionID,
    action: "edit",
    resources: [],
    metadata: {},
  }
}

function stepStarted(id: string, sessionID = "session"): V2Event {
  return {
    id,
    type: "session.next.step.started",
    data: {
      sessionID,
      assistantMessageID: `msg_${id}`,
      timestamp: 0,
      agent: "build",
      model: { id: "model", providerID: "provider" },
    },
  }
}

function executionSettled(id: string, sessionID = "session"): V2Event {
  return {
    id,
    type: "session.next.execution.settled",
    data: {
      sessionID,
      timestamp: 0,
      outcome: "success",
    },
  }
}

function stepFailed(id: string, sessionID = "session"): V2Event {
  return {
    id,
    type: "session.next.step.failed",
    data: {
      sessionID,
      assistantMessageID: `msg_${id}`,
      timestamp: 0,
      error: { type: "unknown", message: "boom" },
    },
  }
}

const formNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Input needs response",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const permissionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Permission needs input",
  notification: { when: "blurred" },
  sound: { name: "permission", when: "always" },
}

describe("internal notifications TUI plugin", () => {
  test("notifies for form and permission requests with blurred notifications and always-on sounds", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "form.created", data: { form: form("form-1") } })
    harness.emit({ id: "event-2", type: "permission.v2.asked", data: permission("permission-1") })

    expect(harness.notifications).toEqual([formNotification, permissionNotification])
  })

  test("dedupes pending forms and permissions until they are resolved", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "form.created", data: { form: form("form-1") } })
    harness.emit({ id: "event-2", type: "form.created", data: { form: form("form-1") } })
    harness.emit({
      id: "event-3",
      type: "form.replied",
      data: { sessionID: "session", id: "form-1", answer: {} },
    })
    harness.emit({ id: "event-4", type: "form.created", data: { form: form("form-1") } })

    harness.emit({ id: "event-5", type: "permission.v2.asked", data: permission("permission-1") })
    harness.emit({ id: "event-6", type: "permission.v2.asked", data: permission("permission-1") })
    harness.emit({
      id: "event-7",
      type: "permission.v2.replied",
      data: { sessionID: "session", requestID: "permission-1", reply: "once" },
    })
    harness.emit({ id: "event-8", type: "permission.v2.asked", data: permission("permission-1") })

    expect(harness.notifications).toEqual([
      formNotification,
      formNotification,
      permissionNotification,
      permissionNotification,
    ])
  })

  test("notifies when an active session becomes idle and suppresses no-op idle", async () => {
    const harness = await setup()

    harness.emit(executionSettled("event-1"))
    harness.emit(stepStarted("event-2"))
    harness.emit(executionSettled("event-3"))

    expect(harness.notifications).toEqual([
      {
        title: "Demo session",
        message: "Session done",
        notification: { when: "blurred" },
        sound: { name: "done", when: "always" },
      },
    ])
  })

  test("uses sound-only notifications and subagent_done sound for subagent sessions", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "form.created", data: { form: form("form-1", "subagent") } })
    harness.emit(stepStarted("event-2", "subagent"))
    harness.emit(executionSettled("event-3", "subagent"))

    expect(harness.notifications).toEqual([
      {
        title: "Subagent session",
        message: "Input needs response",
        notification: false,
        sound: { name: "question", when: "always" },
      },
      {
        title: "Subagent session",
        message: "Session done",
        notification: false,
        sound: { name: "subagent_done", when: "always" },
      },
    ])
  })

  test("notifies session errors once and suppresses the following idle done notification", async () => {
    const harness = await setup()

    harness.emit(stepStarted("event-1"))
    harness.emit(stepFailed("event-2"))
    harness.emit(executionSettled("event-3"))

    expect(harness.notifications).toEqual([
      {
        title: "Demo session",
        message: "Session error",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
    ])
  })

  test("special-cases aborts and model response timeouts", async () => {
    const harness = await setup()

    harness.emit(stepStarted("event-1", "abort"))
    harness.emit({
      id: "event-2",
      type: "session.error",
      data: { sessionID: "abort", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
    })
    harness.emit(stepStarted("event-3", "timeout"))
    harness.emit({
      id: "event-4",
      type: "session.error",
      data: { sessionID: "timeout", error: { name: "UnknownError", data: { message: "SSE read timed out" } } },
    })

    expect(harness.notifications).toEqual([
      {
        title: "Abort session",
        message: "Session aborted",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
      {
        title: "Timeout session",
        message: "Model stopped responding",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
    ])
  })
})

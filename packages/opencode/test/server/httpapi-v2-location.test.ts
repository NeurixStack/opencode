import { afterEach, describe, expect, test } from "bun:test"
import { Context, Schema } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

const Event = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  location: Schema.Struct({
    directory: Schema.String,
    project: Schema.Struct({ id: Schema.String, directory: Schema.String }),
  }),
  data: Schema.Unknown,
})
const EventEnvelope = Schema.Struct({ type: Schema.String })

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const value = await reader.read()
  if (value.done) throw new Error("event stream closed")
  return JSON.parse(new TextDecoder().decode(value.value).replace(/^data: /, ""))
}

async function readEventType(reader: ReadableStreamDefaultReader<Uint8Array>, type: string) {
  for (let index = 0; index < 20; index++) {
    const event = await readEvent(reader)
    if (Schema.decodeUnknownSync(EventEnvelope)(event).type === type) return event
  }
  throw new Error(`timed out waiting for ${type}`)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 location HttpApi", () => {
  test("skips unrelated event payload shapes while waiting for a type", async () => {
    const encoder = new TextEncoder()
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"id":"1","type":"project.updated","location":{"directory":"/tmp"},"data":{}}'),
        )
        controller.enqueue(
          encoder.encode(
            'data: {"id":"2","type":"session.created","location":{"directory":"/tmp","project":{"id":"project","directory":"/tmp"}},"data":{"sessionID":"session"}}',
          ),
        )
        controller.close()
      },
    }).getReader()

    expect(Schema.decodeUnknownSync(Event)(await readEventType(reader, "session.created"))).toMatchObject({
      type: "session.created",
      data: { sessionID: "session" },
    })
  })

  test("returns command and skill snapshots with resolved locations", async () => {
    await using tmp = await tmpdir({ git: true })

    for (const route of ["/api/command", "/api/skill"]) {
      const response = await request(route, tmp.path)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        location: { directory: string; project: { id: string } }
        data: unknown
      }
      expect(body.data).toBeArray()
      expect(body.location.directory).toBe(tmp.path)
      expect(body.location.project.id).toBeTruthy()
    }
  })

  test("streams native EventV2 payloads with resolved locations", async () => {
    await using tmp = await tmpdir({ git: true })
    const response = await request("/api/event", tmp.path)
    const reader = response.body!.getReader()
    expect(Schema.decodeUnknownSync(EventEnvelope)(await readEventType(reader, "server.connected")).type).toBe(
      "server.connected",
    )

    const created = await request("/session", tmp.path, { method: "POST" })
    expect(created.status).toBe(200)
    expect(Schema.decodeUnknownSync(Event)(await readEventType(reader, "session.created"))).toMatchObject({
      type: "session.created",
      location: { directory: tmp.path, project: { directory: tmp.path } },
      data: { sessionID: expect.any(String) },
    })
    await reader.cancel()
  })
})

import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ChildSessionPicker"
const projectID = "proj_child_session_picker"
const rootID = "ses_root"
const newestRunningID = "ses_new_running"
const olderRunningID = "ses_old_running"
const newestIdleID = "ses_new_idle"

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })

test("opens from the hotkey and navigates running child agents first", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "child-session-picker",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [
      session(rootID, "Coordinate the release", 1),
      session(olderRunningID, "Review accessibility (@review subagent)", 2, "review"),
      session(newestRunningID, "Trace the session state (@explore subagent)", 4, "explore"),
      session(newestIdleID, "Summarize the API (@docs subagent)", 5, "docs"),
    ],
    statuses: {
      [olderRunningID]: { type: "busy" },
      [newestRunningID]: { type: "busy" },
      [newestIdleID]: { type: "idle" },
    },
    pageMessages: () => ({ items: [] }),
  })
  await configurePage(page)

  await page.goto(sessionHref(rootID))
  await expectSessionTitle(page, "Coordinate the release")
  const input = page.getByRole("textbox", { name: /Ask anything/ })
  await expect(input).toBeVisible()

  await page.keyboard.press("Control+Shift+ArrowDown")
  await expect(page.getByText("Child agents", { exact: true })).toBeVisible()
  await expect(input).toBeHidden()

  const options = page.getByRole("option")
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toContainText("@explore")
  await expect(options.nth(1)).toContainText("@review")
  await expect(options.nth(2)).toContainText("@docs")
  await expect(options.nth(0)).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(page.getByText("Child agents", { exact: true })).toBeHidden()
  await expect(input).toBeFocused()

  await page.keyboard.press("Control+Shift+ArrowDown")
  await expect(options.nth(0)).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(options.nth(1)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(sessionHref(olderRunningID))
  await expectSessionTitle(page, "Review accessibility")
})

function session(id: string, title: string, updated: number, agent?: string) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    parentID: id === rootID ? undefined : rootID,
    title,
    agent,
    version: "dev",
    time: { created: updated, updated },
  }
}

async function configurePage(page: Page) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  await page.addInitScript(
    ({ directory, dirBase64, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:tabs",
        JSON.stringify([{ type: "session", server, dirBase64, sessionId: sessionID }]),
      )
    },
    { directory, dirBase64: base64Encode(directory), server, sessionID: rootID },
  )
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

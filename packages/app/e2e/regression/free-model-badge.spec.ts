import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/FreeModelBadge"
const projectID = "proj_free_model_badge"
const sessionID = "ses_free_model_badge"

test("shows the Free badge instead of repeating Free in an OpenCode model name", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "free-model-badge",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "glm-5-free": {
              id: "glm-5-free",
              name: "GLM 5 Free",
              cost: { input: 0 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "glm-5-free" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "free-model-badge",
        projectID,
        directory,
        title: "Free model badge",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const composer = page.locator('[data-component="session-composer"]')
  await expectAppVisible(composer)

  const trigger = composer.locator('[data-action="prompt-model"]')
  await expect(trigger).toContainText("GLM 5")
  await expect(trigger).toContainText("Free")
  await expect(trigger).not.toContainText("GLM 5 Free")

  await trigger.click()
  const option = page.getByRole("dialog").getByRole("button", { name: /GLM 5/ })
  await expect(option).toBeVisible()
  await expect(option).toContainText("GLM 5")
  await expect(option).toContainText("Free")
  await expect(option).not.toContainText("GLM 5 Free")

  await page.screenshot({ path: "e2e/test-results/free-model-badge.png" })
})

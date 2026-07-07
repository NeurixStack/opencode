import { expect, test } from "bun:test"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Search } from "@opencode-ai/schema/search"
import { Session } from "@opencode-ai/schema/session"

const SDK = await import("../src/index")

test("re-exports canonical contracts directly from Schema", () => {
  expect(SDK.Agent).toBe(Agent)
  expect(SDK.Model).toBe(Model)
  expect(SDK.Search).toBe(Search)
  expect(SDK.Session).toBe(Session)
  expect(Object.keys(SDK).sort()).toEqual([
    "AbsolutePath",
    "Agent",
    "ClientError",
    "Command",
    "Credential",
    "FileSystem",
    "Integration",
    "Location",
    "Model",
    "OpenCode",
    "Permission",
    "PermissionSaved",
    "Project",
    "ProjectCopy",
    "Prompt",
    "PromptInput",
    "Provider",
    "Pty",
    "Question",
    "Reference",
    "RelativePath",
    "Search",
    "Session",
    "SessionInput",
    "SessionMessage",
    "Skill",
    "Tool",
  ])
})

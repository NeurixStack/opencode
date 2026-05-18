#!/usr/bin/env bun
/**
 * Generator for `09_diverse_llm_responses.json`.
 *
 * Produces a single simulation script that queues 1000 LLM responses with
 * maximum diversity across:
 *   - finish reasons (stop, tool-calls, error, length, unknown)
 *   - step shapes (single text, multi-text, thinking + text, text + tool-call,
 *     multiple tool-calls, thinking-only, error-only)
 *   - tool variety: edit, write, apply_patch, read, grep, glob, bash, todowrite,
 *     webfetch, websearch, lsp, task, task_status, plan, question, skill,
 *     repo_clone, repo_overview, invalid
 *   - parameter shapes per tool (varied filePaths, patterns, commands, queries)
 *
 * The generator is deterministic (seeded RNG) so the same JSON is regenerated.
 *
 * Run with:
 *   bun test/testing/simulation/scripts/09_diverse_llm_responses.gen.ts
 *
 * Output: `09_diverse_llm_responses.json` (next to this file).
 */

import { writeFileSync } from "fs"
import path from "path"

const TOTAL = 1000
const SEED = 0x09abcdef
const OUTPUT_PATH = path.join(import.meta.dirname, "09_diverse_llm_responses.json")

// ─── Seeded RNG (mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
const maybe = (p: number) => rand() < p

// ─── Vocab ───────────────────────────────────────────────────────────────────

const FILE_NAMES = [
  "src/index.ts",
  "src/server.ts",
  "src/util/log.ts",
  "src/util/string.ts",
  "src/feature/auth.ts",
  "src/feature/cart.ts",
  "src/feature/checkout.tsx",
  "src/components/Button.tsx",
  "src/components/Modal.tsx",
  "src/lib/db.ts",
  "src/lib/cache.ts",
  "src/api/users.ts",
  "src/api/orders.ts",
  "test/index.test.ts",
  "test/auth.test.ts",
  "test/cart.test.ts",
  "scripts/build.ts",
  "scripts/deploy.sh",
  "config/eslint.json",
  "config/tsconfig.json",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "docs/api.md",
  "docs/getting-started.md",
  "Dockerfile",
  ".github/workflows/ci.yml",
]

const DIR_NAMES = ["src", "src/feature", "src/util", "test", "scripts", "config", "docs"]

const PATTERNS = [
  "TODO",
  "FIXME",
  "console\\.log",
  "function\\s+\\w+",
  "import .* from",
  "export const",
  "throw new Error",
  "async\\s+function",
  "class\\s+\\w+",
  "interface\\s+\\w+",
]

const GLOBS = [
  "**/*.ts",
  "**/*.tsx",
  "src/**/*.ts",
  "test/**/*.test.ts",
  "**/*.{ts,tsx}",
  "**/*.md",
  "**/*.json",
  "scripts/*.sh",
]

const COMMANDS = [
  "ls -la",
  "pwd",
  "cat README.md",
  "wc -l src/index.ts",
  "git status",
  "git log --oneline -5",
  "git diff --stat",
  "bun install",
  "bun test",
  "bun run build",
  "npm run lint",
  "rg TODO",
  "find . -name '*.ts' -newer package.json",
  "echo 'hello'",
  "date",
]

const WEB_URLS = [
  "https://example.com/api/data",
  "https://docs.opencode.ai/configuration",
  "https://github.com/anomalyco/opencode",
  "https://api.openai.com/v1/models",
  "https://registry.npmjs.org/effect",
  "https://nodejs.org/api/fs.html",
  "https://typescript.org/docs/handbook",
]

const SEARCH_QUERIES = [
  "rust async error handling",
  "effect-ts schema validation",
  "react server components",
  "typescript discriminated unions",
  "bun sqlite performance",
  "lsp protocol initialize",
  "git rebase squash workflow",
]

const SKILLS = ["customize-opencode", "effect", "improve-codebase-architecture", "gmail"]

const SUBAGENTS = ["explore", "general"]

const PLAIN_TEXT = [
  "Looking at the code now.",
  "Let me inspect the relevant files.",
  "I'll start by reading the entrypoint.",
  "Checking the test suite for related coverage.",
  "Tracing the call chain through the layer composition.",
  "This looks like a missing dependency in the layer graph.",
  "I'll add a small helper to factor out the duplication.",
  "Renaming the symbol everywhere it's used.",
  "Bumping the version in package.json.",
  "Adding a changelog entry.",
  "Running the formatter.",
  "Re-running the typecheck.",
  "All clean — no type errors.",
  "Tests pass locally.",
  "Drafting the PR description.",
]

const THINKING = [
  "Need to figure out which layer is missing the dependency.",
  "The error stack points at instance-state.ts — likely missing InstanceRef.",
  "Best to check if the cache is being invalidated correctly.",
  "Tradeoff: inline vs extract helper. Inline is shorter.",
  "Race condition seems likely given the await boundary.",
  "Looking at the diff to spot the regression.",
  "Need to make sure the test asserts the post-condition.",
  "Let me re-read the spec to be sure.",
]

const FINISH_REASONS: ("stop" | "tool-calls" | "length" | "unknown")[] = [
  "stop",
  "tool-calls",
  "stop",
  "tool-calls",
  "stop",
  "length",
  "stop",
  "unknown",
]

// ─── Tool-call generators ────────────────────────────────────────────────────

type ToolCall = {
  type: "tool-call"
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

let toolCallSeq = 0
const nextToolCallId = () => `tc-${(++toolCallSeq).toString(36)}`

const TOOL_GENERATORS: ReadonlyArray<() => ToolCall> = [
  // edit
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "edit",
    input: {
      filePath: `/opencode/${pick(FILE_NAMES)}`,
      oldString: pick(["return null", "// TODO", "const x = 1", "throw new Error(\"!\")", "if (true)"]),
      newString: pick(["return undefined", "// fixed", "const x = 2", "throw new Error(\"unexpected\")", "if (cond)"]),
      ...(maybe(0.2) ? { replaceAll: true } : {}),
    },
  }),
  // write
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "write",
    input: {
      filePath: `/opencode/${pick(FILE_NAMES)}`,
      content: pick([
        "export const value = 42\n",
        "// generated\nexport default {}\n",
        "TODO: fill in\n",
        '{\n  "version": "0.0.1"\n}\n',
      ]),
    },
  }),
  // apply_patch
  () => {
    const file = `/opencode/${pick(FILE_NAMES)}`
    const before = pick(["return null", "const x = 1", "// old"])
    const after = pick(["return undefined", "const x = 2", "// new"])
    return {
      type: "tool-call",
      toolCallId: nextToolCallId(),
      toolName: "apply_patch",
      input: {
        patchText: `*** Begin Patch\n*** Update File: ${file}\n@@\n-  ${before}\n+  ${after}\n*** End Patch\n`,
      },
    }
  },
  // read
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "read",
    input: {
      filePath: `/opencode/${pick(FILE_NAMES)}`,
      ...(maybe(0.3) ? { offset: int(1, 50) } : {}),
      ...(maybe(0.3) ? { limit: int(10, 200) } : {}),
    },
  }),
  // grep
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "grep",
    input: {
      pattern: pick(PATTERNS),
      ...(maybe(0.5) ? { path: pick(DIR_NAMES) } : {}),
      ...(maybe(0.5) ? { include: pick(["*.ts", "*.tsx", "*.{ts,tsx}", "*.md", "*.json"]) } : {}),
    },
  }),
  // glob
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "glob",
    input: {
      pattern: pick(GLOBS),
      ...(maybe(0.3) ? { path: pick(DIR_NAMES) } : {}),
    },
  }),
  // bash
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "bash",
    input: {
      command: pick(COMMANDS),
      description: pick(["List files", "Show status", "Print working dir", "Run tests", "Lint code"]),
      ...(maybe(0.2) ? { timeout: int(1000, 60000) } : {}),
    },
  }),
  // todowrite
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "todowrite",
    input: {
      todos: Array.from({ length: int(1, 4) }, () => ({
        content: pick([
          "Investigate failing test",
          "Refactor layer composition",
          "Add typecheck step",
          "Update docs",
          "Bump dependencies",
        ]),
        status: pick(["pending", "in_progress", "completed", "cancelled"]),
        priority: pick(["high", "medium", "low"]),
      })),
    },
  }),
  // webfetch
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "webfetch",
    input: {
      url: pick(WEB_URLS),
      ...(maybe(0.4) ? { format: pick(["markdown", "text", "html"]) } : {}),
      ...(maybe(0.2) ? { timeout: int(5, 60) } : {}),
    },
  }),
  // websearch
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "websearch",
    input: {
      query: pick(SEARCH_QUERIES),
      ...(maybe(0.3) ? { numResults: int(1, 10) } : {}),
      ...(maybe(0.3) ? { type: pick(["auto", "fast", "deep"]) } : {}),
    },
  }),
  // lsp
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "lsp",
    input: {
      file: `/opencode/${pick(FILE_NAMES)}`,
      action: pick(["definition", "references", "hover", "documentSymbol", "implementation"]),
      ...(maybe(0.5) ? { position: { line: int(0, 100), character: int(0, 80) } } : {}),
    },
  }),
  // task
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "task",
    input: {
      description: pick(["explore feature", "audit dependency graph", "find usage"]),
      prompt: pick([
        "Look through src/ and summarize the entry points.",
        "Find all call sites for `Bus.publish` and explain what they publish.",
      ]),
      subagent_type: pick(SUBAGENTS),
    },
  }),
  // task_status
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "task_status",
    input: {
      task_id: `task-${int(1, 50).toString(36)}`,
    },
  }),
  // plan
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "plan",
    input: {
      summary: pick([
        "Refactor the layer graph to remove cycles",
        "Add diagnostic logging then propose a fix",
        "Extract a helper and add tests",
      ]),
    },
  }),
  // question
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "question",
    input: {
      questions: [
        {
          question: pick(["Which directory should I scaffold under?", "Approve the rename?"]),
          header: pick(["Pick a directory", "Approve rename"]),
          options: [
            { label: "Yes", description: "Approve" },
            { label: "No", description: "Decline" },
          ],
        },
      ],
    },
  }),
  // skill
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "skill",
    input: { name: pick(SKILLS) },
  }),
  // repo_clone
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "repo_clone",
    input: {
      url: pick(["https://github.com/anomalyco/opencode", "https://github.com/effect-ts/effect"]),
      ...(maybe(0.4) ? { ref: pick(["main", "dev", "v1.0.0"]) } : {}),
    },
  }),
  // repo_overview
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "repo_overview",
    input: {
      ...(maybe(0.5) ? { path: pick(DIR_NAMES) } : {}),
      ...(maybe(0.3) ? { depth: int(1, 4) } : {}),
    },
  }),
  // invalid (sanity / fuzz)
  () => ({
    type: "tool-call",
    toolCallId: nextToolCallId(),
    toolName: "invalid",
    input: {
      tool: pick(["foo", "bar", "definitely_not_a_tool"]),
      error: pick(["unknown tool", "missing argument"]),
    },
  }),
]

// ─── Step-shape generators ───────────────────────────────────────────────────

type Step = ReadonlyArray<
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | ToolCall
>

const STEP_SHAPES: ReadonlyArray<() => Step> = [
  // shape 0: single text
  () => [{ type: "text", content: pick(PLAIN_TEXT) }],
  // shape 1: multi text
  () =>
    Array.from({ length: int(2, 5) }, () => ({
      type: "text" as const,
      content: pick(PLAIN_TEXT),
    })),
  // shape 2: thinking + text
  () => [
    { type: "thinking" as const, content: pick(THINKING) },
    { type: "text" as const, content: pick(PLAIN_TEXT) },
  ],
  // shape 3: text + single tool-call
  () => [{ type: "text" as const, content: pick(PLAIN_TEXT) }, pick(TOOL_GENERATORS)()],
  // shape 4: thinking + text + tool-call
  () => [
    { type: "thinking" as const, content: pick(THINKING) },
    { type: "text" as const, content: pick(PLAIN_TEXT) },
    pick(TOOL_GENERATORS)(),
  ],
  // shape 5: multiple tool calls in one step
  () => [
    { type: "text" as const, content: pick(PLAIN_TEXT) },
    ...Array.from({ length: int(2, 4) }, () => pick(TOOL_GENERATORS)()),
  ],
  // shape 6: thinking only
  () => [{ type: "thinking" as const, content: pick(THINKING) }],
  // shape 7: long narrative (5-8 texts)
  () =>
    Array.from({ length: int(5, 8) }, () => ({
      type: "text" as const,
      content: pick(PLAIN_TEXT),
    })),
  // shape 8: solo tool-call (no preamble)
  () => [pick(TOOL_GENERATORS)()],
]

// ─── Script generator ────────────────────────────────────────────────────────

type LLMScript = {
  steps: Step[]
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  finish?: "stop" | "tool-calls" | "length" | "unknown"
}

function makeScript(): LLMScript {
  const step = pick(STEP_SHAPES)()
  const hasToolCall = step.some((item) => item.type === "tool-call")
  const finish: LLMScript["finish"] = hasToolCall ? "tool-calls" : pick(FINISH_REASONS)
  const inputTokens = int(20, 600)
  const outputTokens = int(4, 250)
  return {
    steps: [step],
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    finish,
  }
}

const scripts: LLMScript[] = Array.from({ length: TOTAL }, makeScript)

// ─── Output ──────────────────────────────────────────────────────────────────

// ─── User-driven consumption loop ────────────────────────────────────────────
//
// `enqueueLLM` only fills the backend queue. To actually consume responses we
// need user messages that drive `doStream` calls. Each user turn typically
// consumes 1-2 scripts (one for the main response, one if a tool-call comes
// back and the loop fetches a follow-up; title-gen on the first turn eats one
// more). We send TURNS user messages so the total consumed roughly matches
// the queue size; the default "Simulation mock response." catches any
// remainder.

const PROMPTS = [
  "Walk me through the project layout briefly.",
  "Find any TODOs in the codebase.",
  "Refactor the small helper in src/util/log.ts.",
  "Open src/index.ts and explain the entrypoint.",
  "Search for `console.log` usage.",
  "Run the test suite.",
  "Patch the greeting in src/greeting.ts to say Hello.",
  "Write a small note in docs/getting-started.md.",
  "Show me recent git activity.",
  "What's the LSP status?",
  "Plan a fix for the failing test.",
  "Summarize the changes so far.",
  "Look up the npm registry entry for `effect`.",
  "Search the web for `lsp protocol initialize`.",
  "Outline the next refactor step.",
]

const TURNS = Math.ceil(TOTAL / 2) // ~2 LLM calls per turn on average

const userActions = Array.from({ length: TURNS }, (_, i) => [
  { type: "typeText", text: PROMPTS[i % PROMPTS.length]! },
  { type: "pressEnter" },
  // Small wait so the prompt loop can drain LLM calls before the next input.
  { type: "wait", ms: 60 },
]).flat()

const script = {
  _comment: `Generated by 09_diverse_llm_responses.gen.ts. ${TOTAL} LLM responses with diverse step shapes, tool calls (every registered tool kind), and finish reasons. Followed by ${TURNS} user turns that drive the backend to consume them. Seed: 0x${SEED.toString(16)}. Re-run the generator to regenerate.`,
  actions: [
    // Enter Build mode (skip default plan agent).
    { type: "pressKey", key: "x", modifiers: { ctrl: true } },
    { type: "pressKey", key: "b" },
    { type: "enqueueLLM", scripts },
    ...userActions,
  ],
}

writeFileSync(OUTPUT_PATH, JSON.stringify(script, null, 2) + "\n")

// ─── Summary printed for the developer ───────────────────────────────────────

const byFinish = scripts.reduce(
  (acc, s) => {
    const k = s.finish ?? "stop"
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  },
  {} as Record<string, number>,
)

const byTool: Record<string, number> = {}
let totalToolCalls = 0
for (const s of scripts) {
  for (const step of s.steps) {
    for (const item of step) {
      if (item.type === "tool-call") {
        byTool[item.toolName] = (byTool[item.toolName] ?? 0) + 1
        totalToolCalls++
      }
    }
  }
}

console.log(`Wrote ${OUTPUT_PATH}`)
console.log(`Scripts: ${scripts.length}`)
console.log(`Finish reasons:`, byFinish)
console.log(`Tool calls (${totalToolCalls} total):`, byTool)

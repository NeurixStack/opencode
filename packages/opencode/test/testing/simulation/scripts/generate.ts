#!/usr/bin/env bun
/**
 * Simulation script generator.
 *
 * Builds a single simulation script (JSON) that:
 *   1. Enters Build mode (ctrl+x, b).
 *   2. Optionally seeds the simulated filesystem with a starter set of files.
 *   3. Queues N LLM responses chosen by step-shape and tool-kind weights.
 *   4. Drives the TUI through M user turns to consume those LLM responses.
 *
 * Critically: a stateful FS model tracks which paths exist at each step, so
 * `apply_patch`/`edit`/`read` tool calls only ever target real files. `write`
 * tool calls add new files into the model so later patches can target them.
 *
 * Usage:
 *   bun test/testing/simulation/scripts/generate.ts [options]
 *
 * Options:
 *   --out <path>           Output JSON path. Default: ./generated.json
 *   --total <n>            Total LLM scripts to queue. Default: 1000
 *   --turns <n>            Number of user turns. Default: ceil(total / 2)
 *   --seed <n>             RNG seed (hex or decimal). Default: 0x09abcdef
 *   --tools <list>         Comma-separated tool kinds to include. Default: all.
 *   --shapes <list>        Comma-separated step shapes. Default: all.
 *   --weight tool=<n>      Override weight for a single tool. Repeatable.
 *   --weight shape=<n>     Override weight for a single shape. Repeatable.
 *   --seed-files           Pre-seed common files into the simulated FS.
 *                          Default: true. Pass --no-seed-files to disable.
 *   --enable-titles        Enqueue +1 short script per turn for title gen.
 *                          Default: true. Pass --no-enable-titles to disable.
 *
 * Examples:
 *
 *   # Default: 1000 scripts, 500 turns, balanced tool mix
 *   bun generate.ts --out diverse.json
 *
 *   # Patch-heavy run: only apply_patch + read, 200 turns
 *   bun generate.ts --total 600 --turns 200 \
 *     --tools apply_patch,read --out patches.json
 *
 *   # Bias towards bash + apply_patch
 *   bun generate.ts --weight tool.apply_patch=10 --weight tool.bash=10
 */

import { writeFileSync } from "fs"
import path from "path"

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  out: string
  total: number
  turns: number
  seed: number
  tools: Set<string> | null
  shapes: Set<string> | null
  toolWeights: Record<string, number>
  shapeWeights: Record<string, number>
  seedFiles: boolean
  enableTitles: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    out: "./generated.json",
    total: 1000,
    turns: -1,
    seed: 0x09abcdef,
    tools: null,
    shapes: null,
    toolWeights: {},
    shapeWeights: {},
    seedFiles: true,
    enableTitles: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    switch (a) {
      case "--out":
        out.out = next()
        break
      case "--total":
        out.total = Number(next())
        break
      case "--turns":
        out.turns = Number(next())
        break
      case "--seed": {
        const v = next()
        out.seed = v.startsWith("0x") ? parseInt(v, 16) : Number(v)
        break
      }
      case "--tools":
        out.tools = new Set(
          next()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
        break
      case "--shapes":
        out.shapes = new Set(
          next()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
        break
      case "--weight": {
        // `tool.apply_patch=5` or `shape.toolCall=3`
        const value = next()
        const eq = value.indexOf("=")
        if (eq < 0) throw new Error(`--weight expects key=number, got ${value}`)
        const [k, v] = [value.slice(0, eq), Number(value.slice(eq + 1))]
        if (k.startsWith("tool.")) out.toolWeights[k.slice(5)] = v
        else if (k.startsWith("shape.")) out.shapeWeights[k.slice(6)] = v
        else throw new Error(`--weight key must start with tool. or shape., got ${k}`)
        break
      }
      case "--seed-files":
        out.seedFiles = true
        break
      case "--no-seed-files":
        out.seedFiles = false
        break
      case "--enable-titles":
        out.enableTitles = true
        break
      case "--no-enable-titles":
        out.enableTitles = false
        break
      case "--help":
      case "-h":
        printHelp()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }
  if (out.turns < 0) out.turns = Math.ceil(out.total / 2)
  return out
}

function printHelp() {
  console.log(`Simulation script generator.

Usage:
  bun generate.ts [options]

Options:
  --out <path>           Output JSON path (default ./generated.json)
  --total <n>            Total LLM scripts to queue (default 1000)
  --turns <n>            User turns (default ceil(total/2))
  --seed <n>             RNG seed (hex or decimal, default 0x09abcdef)
  --tools <list>         Comma-separated tool kinds to include
  --shapes <list>        Comma-separated step shapes
  --weight tool.<id>=<n> Override weight for a tool
  --weight shape.<id>=<n> Override weight for a step shape
  --seed-files           Pre-seed starter files (default on)
  --no-seed-files        Skip pre-seeding files
  --enable-titles        Pad queue for title-gen calls (default on)
  --no-enable-titles     Don't pad for title-gen

Available tool kinds:
  apply_patch, edit, write, read, grep, glob, bash, todowrite, webfetch,
  websearch, lsp, task, task_status, plan, question, skill, repo_clone,
  repo_overview, invalid

Available step shapes:
  text, multiText, thinkText, textToolCall, thinkTextToolCall, multiToolCall,
  thinkOnly, longNarrative, soloToolCall
`)
}

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

// ─── Filesystem model ────────────────────────────────────────────────────────
//
// Tracks the file paths that we've materialized so far. `apply_patch`/`edit`/
// `read` only target paths in this set. `write` adds to the set. The pre-seed
// step populates the initial set so the first random scripts have something to
// patch.

class FsModel {
  private paths = new Set<string>()
  private seeded: { path: string; content: string }[] = []

  seed(path: string, content: string) {
    this.paths.add(path)
    this.seeded.push({ path, content })
  }
  add(path: string) {
    this.paths.add(path)
  }
  has(path: string) {
    return this.paths.has(path)
  }
  all(): string[] {
    return [...this.paths]
  }
  seededWrites() {
    return this.seeded
  }
}

// ─── Vocab ───────────────────────────────────────────────────────────────────

const SEED_FILES: { path: string; content: string }[] = [
  { path: "src/index.ts", content: "export function main() {\n  return 0\n}\n" },
  { path: "src/server.ts", content: "export const server = {\n  start() {},\n}\n" },
  { path: "src/util/log.ts", content: "export function log(msg: string) {\n  console.log(msg)\n}\n" },
  { path: "src/util/string.ts", content: "export const upper = (s: string) => s.toUpperCase()\n" },
  { path: "src/feature/auth.ts", content: "export const auth = { user: null }\n" },
  { path: "src/feature/cart.ts", content: "export const cart: string[] = []\n" },
  { path: "src/lib/db.ts", content: "export const db = { query() { return null } }\n" },
  { path: "src/lib/cache.ts", content: "export const cache = new Map<string, unknown>()\n" },
  { path: "src/api/users.ts", content: "export const users = []\n" },
  { path: "test/index.test.ts", content: "import { test } from 'bun:test'\ntest('ok', () => {})\n" },
  { path: "test/auth.test.ts", content: "import { test } from 'bun:test'\ntest('auth', () => {})\n" },
  { path: "README.md", content: "# project\n\nDescription.\n" },
  { path: "docs/api.md", content: "# api\n\nDocs.\n" },
  { path: "docs/getting-started.md", content: "# getting started\n\nWelcome.\n" },
  { path: "package.json", content: '{\n  "name": "project",\n  "version": "0.1.0"\n}\n' },
]

const NEW_FILE_CANDIDATES = [
  "src/feature/checkout.tsx",
  "src/components/Button.tsx",
  "src/components/Modal.tsx",
  "src/api/orders.ts",
  "test/cart.test.ts",
  "scripts/build.ts",
  "config/eslint.json",
  "CHANGELOG.md",
  "src/lib/format.ts",
  "src/lib/clock.ts",
]

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

const GLOBS = ["**/*.ts", "**/*.tsx", "src/**/*.ts", "test/**/*.test.ts", "**/*.{ts,tsx}", "**/*.md", "**/*.json"]

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
  "rg TODO",
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

// ─── Tool generators ─────────────────────────────────────────────────────────

type ToolCall = {
  type: "tool-call"
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

interface Helpers {
  rand: () => number
  pick: <T>(items: readonly T[]) => T
  int: (min: number, max: number) => number
  maybe: (p: number) => boolean
  nextToolCallId: () => string
  fs: FsModel
}

const TOOL_KINDS = [
  "apply_patch",
  "edit",
  "write",
  "read",
  "grep",
  "glob",
  "bash",
  "todowrite",
  "webfetch",
  "websearch",
  "lsp",
  "task",
  "task_status",
  "plan",
  "question",
  "skill",
  "repo_clone",
  "repo_overview",
  "invalid",
] as const
type ToolKind = (typeof TOOL_KINDS)[number]

// Tool generators take the helpers + return a ToolCall, or null if the tool
// can't be produced right now (e.g. apply_patch needs an existing file).
type ToolGen = (h: Helpers) => ToolCall | null

const TOOL_GENERATORS: Record<ToolKind, ToolGen> = {
  apply_patch: (h) => {
    const existing = h.fs.all()
    if (existing.length === 0) return null
    const file = `/opencode/${h.pick(existing)}`
    const before = h.pick(["export const", "return", "function", "import"])
    const after = h.pick(["export default", "return undefined", "async function", "import type"])
    return {
      type: "tool-call",
      toolCallId: h.nextToolCallId(),
      toolName: "apply_patch",
      input: {
        patchText: `*** Begin Patch\n*** Update File: ${file}\n@@\n-  ${before}\n+  ${after}\n*** End Patch\n`,
      },
    }
  },
  edit: (h) => {
    const existing = h.fs.all()
    if (existing.length === 0) return null
    return {
      type: "tool-call",
      toolCallId: h.nextToolCallId(),
      toolName: "edit",
      input: {
        filePath: `/opencode/${h.pick(existing)}`,
        oldString: h.pick(["return null", "// TODO", "const x = 1", "if (true)"]),
        newString: h.pick(["return undefined", "// fixed", "const x = 2", "if (cond)"]),
        ...(h.maybe(0.2) ? { replaceAll: true } : {}),
      },
    }
  },
  write: (h) => {
    const candidates = NEW_FILE_CANDIDATES.filter((p) => !h.fs.has(p))
    const file = candidates.length > 0 ? h.pick(candidates) : h.pick(NEW_FILE_CANDIDATES)
    const content = h.pick([
      "export const value = 42\n",
      "// generated\nexport default {}\n",
      "TODO: fill in\n",
      '{\n  "version": "0.0.1"\n}\n',
    ])
    // Track the write so future apply_patch/edit can target it.
    h.fs.add(file)
    return {
      type: "tool-call",
      toolCallId: h.nextToolCallId(),
      toolName: "write",
      input: { filePath: `/opencode/${file}`, content },
    }
  },
  read: (h) => {
    const existing = h.fs.all()
    if (existing.length === 0) return null
    return {
      type: "tool-call",
      toolCallId: h.nextToolCallId(),
      toolName: "read",
      input: {
        filePath: `/opencode/${h.pick(existing)}`,
        ...(h.maybe(0.3) ? { offset: h.int(1, 50) } : {}),
        ...(h.maybe(0.3) ? { limit: h.int(10, 200) } : {}),
      },
    }
  },
  grep: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "grep",
    input: {
      pattern: h.pick(PATTERNS),
      ...(h.maybe(0.5) ? { path: h.pick(["src", "src/feature", "src/util", "test", "docs"]) } : {}),
      ...(h.maybe(0.5) ? { include: h.pick(["*.ts", "*.tsx", "*.{ts,tsx}", "*.md"]) } : {}),
    },
  }),
  glob: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "glob",
    input: {
      pattern: h.pick(GLOBS),
      ...(h.maybe(0.3) ? { path: h.pick(["src", "test", "docs"]) } : {}),
    },
  }),
  bash: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "bash",
    input: {
      command: h.pick(COMMANDS),
      description: h.pick(["List files", "Show status", "Print working dir", "Run tests"]),
      ...(h.maybe(0.2) ? { timeout: h.int(1000, 60000) } : {}),
    },
  }),
  todowrite: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "todowrite",
    input: {
      todos: Array.from({ length: h.int(1, 4) }, () => ({
        content: h.pick([
          "Investigate failing test",
          "Refactor layer composition",
          "Add typecheck step",
          "Update docs",
          "Bump dependencies",
        ]),
        status: h.pick(["pending", "in_progress", "completed", "cancelled"]),
        priority: h.pick(["high", "medium", "low"]),
      })),
    },
  }),
  webfetch: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "webfetch",
    input: {
      url: h.pick(WEB_URLS),
      ...(h.maybe(0.4) ? { format: h.pick(["markdown", "text", "html"]) } : {}),
      ...(h.maybe(0.2) ? { timeout: h.int(5, 60) } : {}),
    },
  }),
  websearch: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "websearch",
    input: {
      query: h.pick(SEARCH_QUERIES),
      ...(h.maybe(0.3) ? { numResults: h.int(1, 10) } : {}),
      ...(h.maybe(0.3) ? { type: h.pick(["auto", "fast", "deep"]) } : {}),
    },
  }),
  lsp: (h) => {
    const existing = h.fs.all().filter((p) => /\.(ts|tsx|js|jsx)$/.test(p))
    const file = existing.length > 0 ? `/opencode/${h.pick(existing)}` : "/opencode/src/index.ts"
    return {
      type: "tool-call",
      toolCallId: h.nextToolCallId(),
      toolName: "lsp",
      input: {
        file,
        action: h.pick(["definition", "references", "hover", "documentSymbol", "implementation"]),
        ...(h.maybe(0.5) ? { position: { line: h.int(0, 100), character: h.int(0, 80) } } : {}),
      },
    }
  },
  task: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "task",
    input: {
      description: h.pick(["explore feature", "audit dependency graph", "find usage"]),
      prompt: h.pick([
        "Look through src/ and summarize the entry points.",
        "Find all call sites for `Bus.publish` and explain what they publish.",
      ]),
      subagent_type: h.pick(SUBAGENTS),
    },
  }),
  task_status: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "task_status",
    input: { task_id: `task-${h.int(1, 50).toString(36)}` },
  }),
  plan: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "plan",
    input: {
      summary: h.pick([
        "Refactor the layer graph to remove cycles",
        "Add diagnostic logging then propose a fix",
        "Extract a helper and add tests",
      ]),
    },
  }),
  question: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "question",
    input: {
      questions: [
        {
          question: h.pick(["Which directory should I scaffold under?", "Approve the rename?"]),
          header: h.pick(["Pick a directory", "Approve rename"]),
          options: [
            { label: "Yes", description: "Approve" },
            { label: "No", description: "Decline" },
          ],
        },
      ],
    },
  }),
  skill: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "skill",
    input: { name: h.pick(SKILLS) },
  }),
  repo_clone: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "repo_clone",
    input: {
      url: h.pick(["https://github.com/anomalyco/opencode", "https://github.com/effect-ts/effect"]),
      ...(h.maybe(0.4) ? { ref: h.pick(["main", "dev", "v1.0.0"]) } : {}),
    },
  }),
  repo_overview: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "repo_overview",
    input: {
      ...(h.maybe(0.5) ? { path: h.pick(["src", "test", "docs"]) } : {}),
      ...(h.maybe(0.3) ? { depth: h.int(1, 4) } : {}),
    },
  }),
  invalid: (h) => ({
    type: "tool-call",
    toolCallId: h.nextToolCallId(),
    toolName: "invalid",
    input: {
      tool: h.pick(["foo", "bar", "definitely_not_a_tool"]),
      error: h.pick(["unknown tool", "missing argument"]),
    },
  }),
}

const DEFAULT_TOOL_WEIGHTS: Record<ToolKind, number> = {
  apply_patch: 4,
  edit: 3,
  write: 3,
  read: 4,
  grep: 3,
  glob: 3,
  bash: 2,
  todowrite: 2,
  webfetch: 2,
  websearch: 2,
  lsp: 2,
  task: 2,
  task_status: 1,
  plan: 2,
  question: 1,
  skill: 1,
  repo_clone: 1,
  repo_overview: 1,
  invalid: 1,
}

// ─── Step shapes ─────────────────────────────────────────────────────────────

type StepItem =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | ToolCall

type ShapeKind =
  | "text"
  | "multiText"
  | "thinkText"
  | "textToolCall"
  | "thinkTextToolCall"
  | "multiToolCall"
  | "thinkOnly"
  | "longNarrative"
  | "soloToolCall"

interface ShapeContext {
  h: Helpers
  pickTool: () => ToolCall | null
}

const SHAPE_BUILDERS: Record<ShapeKind, (ctx: ShapeContext) => StepItem[] | null> = {
  text: ({ h }) => [{ type: "text", content: h.pick(PLAIN_TEXT) }],
  multiText: ({ h }) =>
    Array.from({ length: h.int(2, 5) }, () => ({ type: "text" as const, content: h.pick(PLAIN_TEXT) })),
  thinkText: ({ h }) => [
    { type: "thinking", content: h.pick(THINKING) },
    { type: "text", content: h.pick(PLAIN_TEXT) },
  ],
  textToolCall: ({ h, pickTool }) => {
    const tc = pickTool()
    if (!tc) return null
    return [{ type: "text", content: h.pick(PLAIN_TEXT) }, tc]
  },
  thinkTextToolCall: ({ h, pickTool }) => {
    const tc = pickTool()
    if (!tc) return null
    return [
      { type: "thinking", content: h.pick(THINKING) },
      { type: "text", content: h.pick(PLAIN_TEXT) },
      tc,
    ]
  },
  multiToolCall: ({ h, pickTool }) => {
    const count = h.int(2, 4)
    const tcs: ToolCall[] = []
    for (let i = 0; i < count; i++) {
      const tc = pickTool()
      if (tc) tcs.push(tc)
    }
    if (tcs.length === 0) return null
    return [{ type: "text", content: h.pick(PLAIN_TEXT) }, ...tcs]
  },
  thinkOnly: ({ h }) => [{ type: "thinking", content: h.pick(THINKING) }],
  longNarrative: ({ h }) =>
    Array.from({ length: h.int(5, 8) }, () => ({ type: "text" as const, content: h.pick(PLAIN_TEXT) })),
  soloToolCall: ({ pickTool }) => {
    const tc = pickTool()
    if (!tc) return null
    return [tc]
  },
}

const DEFAULT_SHAPE_WEIGHTS: Record<ShapeKind, number> = {
  text: 3,
  multiText: 2,
  thinkText: 2,
  textToolCall: 5,
  thinkTextToolCall: 3,
  multiToolCall: 2,
  thinkOnly: 1,
  longNarrative: 2,
  soloToolCall: 2,
}

// ─── Weighted picker ─────────────────────────────────────────────────────────

function weightedPicker<K extends string>(weights: Record<K, number>, rand: () => number) {
  const entries = Object.entries(weights) as [K, number][]
  const positive = entries.filter(([, w]) => w > 0)
  if (positive.length === 0) throw new Error("All weights are zero")
  const total = positive.reduce((sum, [, w]) => sum + w, 0)
  return () => {
    let r = rand() * total
    for (const [k, w] of positive) {
      r -= w
      if (r <= 0) return k
    }
    return positive[positive.length - 1]![0]
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2))

  const rand = mulberry32(opts.seed)
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  const maybe = (p: number) => rand() < p

  let toolCallSeq = 0
  const nextToolCallId = () => `tc-${(++toolCallSeq).toString(36)}`

  const fs = new FsModel()
  if (opts.seedFiles) for (const f of SEED_FILES) fs.seed(f.path, f.content)

  const helpers: Helpers = { rand, pick, int, maybe, nextToolCallId, fs }

  const enabledTools = (TOOL_KINDS as readonly ToolKind[]).filter(
    (t) => !opts.tools || opts.tools.has(t),
  )
  if (enabledTools.length === 0) throw new Error("--tools filter excluded every tool")
  const toolWeights = Object.fromEntries(
    enabledTools.map((t) => [t, opts.toolWeights[t] ?? DEFAULT_TOOL_WEIGHTS[t]]),
  ) as Record<ToolKind, number>
  const pickToolKind = weightedPicker(toolWeights, rand)

  const enabledShapes = (Object.keys(DEFAULT_SHAPE_WEIGHTS) as ShapeKind[]).filter(
    (s) => !opts.shapes || opts.shapes.has(s),
  )
  if (enabledShapes.length === 0) throw new Error("--shapes filter excluded every shape")
  const shapeWeights = Object.fromEntries(
    enabledShapes.map((s) => [s, opts.shapeWeights[s] ?? DEFAULT_SHAPE_WEIGHTS[s]]),
  ) as Record<ShapeKind, number>
  const pickShapeKind = weightedPicker(shapeWeights, rand)

  // Resolve a tool, retrying up to N times if a generator returns null (e.g.
  // apply_patch with no existing files). If every retry fails, fall back to
  // `text` step shape via returning null upstream.
  const tryPickTool = (): ToolCall | null => {
    for (let i = 0; i < 6; i++) {
      const tc = TOOL_GENERATORS[pickToolKind() as ToolKind](helpers)
      if (tc) return tc
    }
    return null
  }

  type LLMScript = {
    steps: StepItem[][]
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
    finish?: "stop" | "tool-calls" | "length" | "unknown"
  }

  function makeScript(): LLMScript {
    // Try up to 4 different shapes; if none yields a step (e.g. all
    // tool-shape variants returned null), fall back to a `text` step.
    let step: StepItem[] | null = null
    for (let i = 0; i < 4 && !step; i++) {
      const shape = pickShapeKind() as ShapeKind
      step = SHAPE_BUILDERS[shape]({ h: helpers, pickTool: tryPickTool })
    }
    if (!step) step = [{ type: "text", content: pick(PLAIN_TEXT) }]
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

  // Title-gen padding: each user turn the small-model gets invoked too. To
  // keep the user-visible follow-up text from falling back to the default
  // "Simulation mock response.", pad the queue by `turns` extra short scripts.
  const titlePadding = opts.enableTitles ? opts.turns : 0
  const scripts: LLMScript[] = Array.from({ length: opts.total + titlePadding }, makeScript)

  // ─── User actions ──────────────────────────────────────────────────────────

  const userActions = Array.from({ length: opts.turns }, (_, i) => [
    { type: "typeText", text: PROMPTS[i % PROMPTS.length]! },
    { type: "pressEnter" },
    { type: "wait", ms: 60 },
  ]).flat()

  // Seed-file writes go FIRST so the FS exists before user turns run.
  const seedWrites = fs.seededWrites().map((f) => ({
    type: "writeFile",
    path: f.path,
    content: f.content,
  }))

  const script = {
    _comment: `Generated by generate.ts. Seed: 0x${opts.seed.toString(16)}. Total LLM scripts: ${opts.total} (+${titlePadding} title padding = ${scripts.length}). Turns: ${opts.turns}. Tools enabled: ${enabledTools.length}. Pre-seeded files: ${fs.seededWrites().length}.`,
    actions: [
      { type: "pressKey", key: "x", modifiers: { ctrl: true } },
      { type: "pressKey", key: "b" },
      ...seedWrites,
      { type: "enqueueLLM", scripts },
      ...userActions,
    ],
  }

  const outPath = path.resolve(opts.out)
  writeFileSync(outPath, JSON.stringify(script, null, 2) + "\n")

  // ─── Summary ───────────────────────────────────────────────────────────────

  const byFinish: Record<string, number> = {}
  for (const s of scripts) {
    const k = s.finish ?? "stop"
    byFinish[k] = (byFinish[k] ?? 0) + 1
  }
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
  console.log(`Wrote ${outPath}`)
  console.log(`Total scripts: ${scripts.length} (${opts.total} primary + ${titlePadding} title padding)`)
  console.log(`User turns: ${opts.turns}`)
  console.log(`Seeded files: ${fs.seededWrites().length}`)
  console.log(`Finish reasons:`, byFinish)
  console.log(`Tool calls (${totalToolCalls} total):`, byTool)
}

main()

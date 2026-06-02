# opencode

**Open source AI coding agent** — a monorepo for the `opencode` CLI/agent and its surrounding products.

## What it is

- AI-powered terminal coding agent (`opencode` CLI, npm: `opencode-ai`), plus a desktop app and web/console sites.
- Built on **Bun**, **TypeScript**, **Effect v4** (smol), **SolidJS**, **Hono**, **Drizzle** (SQLite), **OpenTUI/Solid** for the TUI, and the Vercel **AI SDK** for LMs.
- Two built-in agents: `build` (default, full-access) and `plan` (read-only), with a `general` subagent.

## Environment variables

- `OPENCODE_INSTALL_DIR`, `XDG_BIN_DIR` — installer location (see README).

## Repo layout (Bun workspaces + Turborepo)

- `packages/opencode` — main CLI/agent (`bun run dev`).
- `packages/app` — web app, `packages/web` — marketing/lander, `packages/desktop` — Electron desktop app.
- `packages/console` + `packages/console/app` + `packages/identity` — hosted console (auth, billing-ish UI) deployed via SST (`sst.config.ts`).
- `packages/stats` — stats service (Cloudflare Worker, see `wrangler.jsonc`).
- `packages/core` — shared core logic (config, sessions, tools, providers, MCP).
- `packages/llm` — model provider adapters on top of the AI SDK.
- `packages/plugin` — plugin/extension system (`@opencode-ai/plugin`).
- `packages/sdk` (+ `sdks/vscode`, `packages/slack`) — JS SDK and integrations.
- `packages/script` — build/CI scripts.
- Supporting libs: `packages/function`, `packages/ui`, `packages/containers`, `packages/extensions`, `packages/docs`, `packages/storybook`, `packages/enterprise`, `packages/cli`, `packages/effect-drizzle-sqlite`, `packages/effect-sqlite-node`, `packages/http-recorder`.
- `infra/` — SST infra; `github/` — GitHub workflow assets; `patches/` — patched deps; `nix/` + `flake.nix` — Nix packaging; `specs/` — specs; `install` — install script.

## Install

```bash
curl -fsSL https://opencode.ai/install | bash
# or: npm i -g opencode-ai@latest, brew install anomalyco/tap/opencode, etc.
```

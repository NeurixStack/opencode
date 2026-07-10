# Architecture Review

Status: WIP investigation. This document records candidates, not approved designs.

Reviewed areas:

- V2 Session runtime in `packages/core`
- Client contract generation across Schema, Protocol, Client, and SDK
- Server network and embedded hosting
- CLI background process lifecycle

The review uses the deletion test: a useful module concentrates complexity when removed; a shallow module merely moves its implementation into a caller.

## 1. Deepen Session inbox promotion

Recommendation: **Strong** and the top candidate.

Files:

- `packages/core/src/session/input.ts:151-263`
- `packages/core/src/session/runner/llm.ts:190-198,417-445`
- `packages/core/test/session-prompt.test.ts:123-436`
- `packages/core/test/session-runner.test.ts:1988-2345`

Problem: steer and queue eligibility, ordering, and Prompt Promotion leak into the Session Runner. The runner repeatedly queries pending delivery modes and selects separate promotion operations, so the runner and inbox jointly define one domain policy.

Direction: deepen the Session inbox module so delivery eligibility, ordering, and Prompt Promotion sit behind one seam. Keep durable admission separate from execution.

Benefits:

- Locality: one module owns delivery policy.
- Leverage: tests exercise one seam.
- The runner loses repeated policy branches.
- The documented steer and queue rules remain explicit.

Deletion test: removing the scattered runner branches would concentrate policy in the inbox rather than move it to another caller.

## 2. Complete Step recording in one module

Recommendation: **Strong**, but higher risk than the inbox change.

Files:

- `packages/core/src/session/runner/publish-llm-event.ts:53-406`
- `packages/core/src/session/runner/llm.ts:224-385`
- `packages/core/test/session-runner-tool-events.test.ts:74-136`
- `packages/core/test/session-runner.test.ts:2688-3449`

Problem: the event publisher records stream fragments, but exposes state and terminal mechanics to the runner. The runner inspects publisher state, settles tool fibers, captures snapshots, publishes `Step.Ended`, and calculates the terminal result.

Direction: deepen Step recording so one module owns recording through settlement while the runner retains the required explicit `llm.stream(request)` call.

Benefits:

- Locality: terminal Step rules live together.
- Leverage: interruption and failure cases can use table-driven tests.
- The interface stops exposing internal publisher state.
- Provider, tool, and snapshot settlement stop leaking into orchestration.

Deletion test: the existing publisher already concentrates a substantial state machine. The opportunity is to remove its shallow state-inspection seam, not its implementation.

## 3. Return background lifecycle to CLI

Recommendation: **Strong**.

Files:

- `packages/client/src/effect/service.ts:1-165`
- `packages/client/src/effect/index.ts:20`
- `packages/cli/src/services/service-config.ts:29-49`
- `packages/cli/src/commands/handlers/default.ts:47-77`
- `packages/cli/src/commands/handlers/serve.ts:69-117`
- `packages/cli/test/service.test.ts:10-25`

Problem: Client exports a Node-specific background process implementation containing process spawning, registration files, health checks, signals, version replacement, and authentication. Only CLI modules consume it, and several handlers repeat discover-or-start policy.

This conflicts with the network-only Client architecture recorded in `CONTEXT.md:172-176`.

Direction: concentrate discovery, registration, replacement, authentication, and restart rules in a deep CLI background module. Keep Client focused on network transport.

Benefits:

- The Client interface shrinks.
- Locality: CLI lifecycle policy lives in CLI.
- A real host adapter replaces a hypothetical Client seam.
- Registration and authentication tests gain one target.

Deletion test: removing the Client daemon module improves locality because it has no non-CLI consumer. Removing a deep CLI replacement would scatter the same lifecycle rules across handlers.

## 4. Collapse Promise source surgery

Recommendation: **Worth exploring**.

Files:

- `packages/httpapi-codegen/src/index.ts:257-278`
- `packages/httpapi-codegen/src/index.ts:591-636`
- `packages/httpapi-codegen/src/index.ts:685-710`
- `packages/httpapi-codegen/test/generate.test.ts:344-387,450-479`

Problem: the Promise emitter first renders TypeScript, then rewrites exact text markers to add binary and wildcard behavior. One part of the implementation depends on another part's private output spelling and formatting.

Direction: deepen the Promise emitter so typed transport facts drive rendering directly.

Benefits:

- Locality: rendering decisions meet emitted code.
- The brittle text-replacement seam disappears.
- Existing runtime tests retain leverage.
- Formatting changes stop becoming generation failures.

Deletion test: deleting `normalizePromiseClientContent` and rendering those decisions directly concentrates implementation instead of moving it.

## 5. Make Client naming total

Recommendation: **Strong**.

Files:

- `packages/protocol/src/client.ts:35-60`
- `packages/httpapi-codegen/src/index.ts:96-101`
- `packages/client/src/promise/generated/client.ts:859`
- `packages/client/src/effect/generated/client.ts:1057`
- `packages/client/test/promise.test.ts:4-33`
- `packages/sdk-next/src/opencode.ts:41-48`

Problem: the consumer naming adapter is partial. Missing entries silently fall back to internal Protocol identifiers, currently leaking `server.mcp` through Promise, Effect, and Embedded OpenCode.

Direction: require an explicit consumer name for every public group and fail generation when naming policy is missing.

Benefits:

- Leverage: one naming policy aligns every emitter.
- Public interfaces expose domain names rather than internal identifiers.
- Missing policy fails during generation.
- Promise, Effect, and Embedded OpenCode remain aligned.

Deletion test: removing the naming adapter would leak every internal identifier. The adapter is necessary but should be deepened into a total policy.

## 6. Deepen Server host assembly

Recommendation: **Strong**.

Files:

- `packages/server/src/routes.ts:31-92`
- `packages/cli/src/commands/handlers/serve.ts:134-153`
- `packages/sdk-next/src/opencode.ts:11-44`
- `packages/sdk-next/test/embedded.test.ts:29-209`

Problem: the network and embedded adapters both understand Server implementation details. Core instance sharing, request injection, memoization, and cleanup leak across the host seams.

Direction: retain both adapters because they establish a real seam, but absorb common host assembly and lifecycle implementation into Server.

Benefits:

- Two adapters continue to justify the seam.
- Locality: host lifecycle belongs to Server.
- Network and embedded behavior can share conformance tests.
- Callers stop depending on Core graph internals.

Deletion test: the current route constructors are shallow, while the hidden route implementation is deep. Promote that depth into the host-facing Server module.

## Top Recommendation

Start with Session inbox promotion. It removes repeated domain policy from the hottest orchestration path, has a smaller migration surface than Step recording, and creates a high-leverage test seam for steer and queue behavior.

Before implementation, settle the desired inbox interface and verify these invariants:

- Durable prompt admission remains separate from execution.
- A blocked first Step leaves pending inputs untouched.
- Steers promote at safe Step boundaries while continuation is required.
- One queued prompt promotes when the Session would otherwise become idle.
- Promoting new user input resets the selected agent's Step allowance.
- The runner keeps one explicit `llm.stream(request)` call per Physical Attempt.

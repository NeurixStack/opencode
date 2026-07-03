# Parked: Settlement Ledger Refactor (runner/llm.ts)

Status: parked by Kit on 2026-07-03. Resume after currently in-flight session-core work merges, then rebase this branch onto `origin/v2` before starting.

Prior art (merged): #35218 ratified the step vocabulary (CONTEXT.md is the glossary); #35227 renamed runner identifiers (`drain` / `runStep` / `attemptStep`) and swept comments. This slice is the structural cleanup those two deliberately deferred.

## Diagnosis

The remaining ugliness in `packages/core/src/session/runner/llm.ts` is not the phase structure (`drain` → `runStep` → `attemptStep` maps cleanly onto the domain) and not the restart loop (already explicit via tagged results). It is evidence ownership:

1. `needsContinuation` is a `let` at attempt scope, flipped deep inside the stream `runForEach` closure, read ~130 lines later in settlement. Action at a distance — and it is derivable from data the publisher already records (a non-provider-executed tool-call arrived).
2. `overflowFailure` is a held-back provider event stored in a local variable, but holding back an overflow is transcript policy and belongs with the transcript owner.
3. The settlement block re-derives combinations of ~8 evidence booleans (`streamInterrupted`, `toolsInterrupted`, `questionDismissed`, `providerFailed`, `infraError`, ...) as it goes, smearing one classification across the whole block.

## Design (agreed)

### 1. Step ledger

Promote the LLM event publisher (`publish-llm-event.ts`) to a step ledger owning all step evidence:

- `needsContinuation` becomes derived: `ledger.hasLocalToolCalls()`.
- Held-back overflow becomes ledger state (`ledger.heldOverflow()` or similar).
- The stream handler becomes near-stateless: admit event to ledger, spawn tool settlement fiber for local calls. No writes to enclosing scope.

### 2. Classify-once settlement

Settlement becomes: gather stream exit -> try overflow recovery -> settle tool fibers -> classify ONCE -> flat verdict-keyed effects.

Classification (local inferred union, no exported type alias needed):

    Interrupted { questionDismissed } | ProviderFailed | ToolInfraFailed { cause } | Clean

Vocabulary note: call the classified value the step's settlement (ratified term), not "verdict"/"end".

NOT a purification: effect ordering is load-bearing and stays in one Effect.gen —
clear fibers before awaiting on interrupt; publish held overflow before classifying;
failUnsettledTools before failAssistant; Step.Ended only on Clean. Only separate
"decide what happened" from "act on it" at the point where all evidence is in hand.

### Open design question (start here — grill before implementing)

The ledger API surface: what does it record vs derive, and do settlement effects (`failUnsettledTools`, `failAssistant`, `publishStepEnd`) move onto the ledger or stay in `attemptStep`? Kit wants a design pass on this before code.

## Non-goals (explicitly rejected)

- No file splits — attemptStep phases stay inline, one linear read.
- No formal state-machine abstraction — tagged restart results are already the right amount.
- No purifying the drain loop in `drain` — small, documented invariants, leave it.
- No renaming durable events or reifying the assistant turn (reserved concept).

## Verification expectations

Behavior-preserving. Focused tests: `packages/core/test/session-runner*.test.ts` (93 passing as of parking). `bun typecheck` from `packages/core`, prettier, file-scoped oxlint.

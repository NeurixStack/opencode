# Session Timeline Frontend Plan

## Status

This plan incorporates reviews of Solid identity, hydration concurrency, Session execution ordering, rendering, scroll behavior, and migration scope. The server contract remains unchanged: projected messages and pending inputs are separate reads, and the event stream has no replay cursor across reconnects.

## Goals

- Never overwrite an admitted prompt with a hydration snapshot.
- Keep one stable rendered identity from admission through promotion and projection.
- Keep projected history semantically distinct from pending frontend work.
- Make the unavoidable snapshot/live-event reconciliation narrow and explicit.
- Preserve targeted updates for streamed assistant content.
- Avoid changing unrelated message consumers in this PR.

## Constraints Discovered In Review

- Promotion atomically deletes pending state and inserts projected state.
- Reading pending before projected history guarantees an input admitted before the pending read appears in at least one response.
- An admission after the pending read may appear in neither response and must survive through its live event.
- The event stream does not replay events missed across a disconnect, so reconnect must perform authoritative reads.
- General event replay is unsafe. Text, reasoning, tool input, and compaction deltas are additive, while snapshots expose no event watermark proving which deltas they contain.
- Solid `<For>` retains children by source-item identity. The existing `SessionRow` values lack a uniform `id`, so full row reduction does not express stable semantic identity.
- OpenTUI sticky scrolling follows the bottom but does not preserve a scrolled-up content anchor when rows are inserted above it.

## Selected Architecture

Keep the existing projected/live message cache. Add a lifecycle overlay containing only pending or locally promoted work.

```ts
type TimelineInput = {
  id: string
  phase: "pending" | "promoted"
  admittedSeq: number
  delivery?: "steer" | "queue"
  message?: SessionMessageInfo
}

type Data = {
  session: {
    message: Record<string, SessionMessageInfo[]>
    input: Record<string, TimelineInput[]>
  }
}
```

The overlay keeps pending content, phase, delivery, and ordering metadata together. It replaces the current parallel representation where content is inserted into `session.message` while only its ID is stored in `session.input`.

Projected messages remain available through the existing projected cache. A small visible-timeline surface composes projected messages with the overlay for rendering:

```ts
timeline.get(sessionID, messageID)
timeline.list(sessionID)
message.refresh(sessionID)
```

Existing `session.message` consumers remain unchanged unless they need pending work. The Session row renderer migrates to the visible timeline surface.

## Lifecycle

Phase precedence is monotone:

```text
projected > promoted > pending
```

Content precedence is:

```text
projected message > pending/admission content > unknown placeholder
```

Admission inserts one pending overlay entry. Promotion changes that entry to `promoted` without removing it. Observing the same ID in projected history removes the overlay entry because projected state is now authoritative.

Promotion-before-admission delivery is tolerated defensively: promotion creates a non-rendered placeholder, and a later admission fills its content without downgrading its phase.

## Hydration

Hydration is sequential:

```ts
const pending = await api.session.pending.list({ sessionID })
const projected = await api.message.list({ sessionID, limit: 200, order: "desc" })
```

For a promotion commit `X`, pending read `P`, and projected read `M`, `P < M` eliminates the unsafe `M < X < P` split snapshot.

The proof is:

- `X < P`: pending omits the input and projected contains it.
- `P < X < M`: pending and projected may both contain it; projected wins by ID.
- `M < X`: pending contains it, and a later promotion event changes its local phase.

An input admitted after `P` and not promoted before `M` is absent from both snapshots. Its live admission operation must be preserved during installation.

## Narrow Hydration Journal

Only input topology operations are journaled:

```ts
type TimelineOperation =
  | { type: "admitted"; input: TimelineInput }
  | { type: "promoted"; inputID: string; promotedSeq: number; created: number }
  | { type: "reverted"; to: string }
```

All existing assistant, text, reasoning, tool, shell, and compaction streaming events continue to update the projected/live message cache exactly once. They are never replayed.

Hydration performs:

1. Open a per-Session lifecycle journal.
2. Continue applying admission and promotion immediately to the visible overlay while recording them.
3. Read pending inputs.
4. Read projected messages.
5. Build projected history and pending overlay from those snapshots.
6. Fold the lifecycle journal onto the overlay with an idempotent, monotone reducer.
7. Remove overlay entries whose IDs are present in projected history.
8. Install projected history and overlay together in one Solid batch.
9. Close the journal.

If either request fails, do not install an authoritative empty collection. Preserve visible state and retry through the existing caller/reconnect path.

## Refresh Coordination

At most one refresh per Session and connection epoch may install.

- Same-epoch callers join the current promise.
- Every `server.connected` increments a connection epoch.
- A result from an older epoch is discarded.
- Reconnect always starts or queues a refresh in the new epoch, even if an old refresh is still running.
- Different Sessions refresh independently.

This prevents an old server response from winning after reconnect.

## Ordering

Visible ordering is derived rather than encoded by array mutation:

1. Projected history in server order.
2. Promoted placeholders in promotion order.
3. Pending compaction barriers.
4. Pending steering inputs in `admittedSeq` order.
5. Pending queued inputs in `admittedSeq` order.

This anticipates normal runner eligibility. Steers are consumed before queues, while compaction blocks both. A legitimate queue/steer interleaving selected by the runner is represented by durable promotion order once promoted.

Compaction remains on its existing message lifecycle in the first implementation unless pending compaction coverage can be added without conflating its different event model with ordinary input admission.

## Solid Identity

The visible timeline feeds a row reducer whose output has stable IDs. Rendering reconciles those rows by ID before passing them to `<For>`:

```tsx
setRows(reconcile(reduce(), { key: "id" }))

<For each={rows}>
  {(row) => <SessionRowView row={row} />}
</For>
```

The existing row reducer expands messages into message, part, exploration-group, and footer rows. Every `SessionRow` must gain a deterministic `id`:

```ts
type SessionRow =
  | { id: `message:${string}`; type: "message"; messageID: string }
  | { id: `part:${string}:${string}`; type: "part"; ref: PartRef }
  | { id: `assistant-footer:${string}`; type: "assistant-footer"; messageID: string }
  | { id: `group:exploration:${string}`; type: "group"; /* ... */ }
```

Rows are installed through `reconcile(rows, { key: "id" })`. Exploration group identity is seeded from the first part that creates the group and remains fixed as refs move between pending and completed partitions.

The outer OpenTUI row wrapper receives the same stable row ID so ownership and scroll anchoring are observable in tests.

## Scroll Policy

Stable identity prevents remounting but not geometric scroll movement.

- Existing `stickyScroll` and `stickyStart="bottom"` continue to own bottom-following behavior.
- Ordinary admission/promotion updates should not run explicit anchoring.
- Explicit anchoring is deferred unless a deterministic regression shows hydration changes the viewed content while manually scrolled up.
- If required, capture the first visible stable row ID and viewport offset before snapshot installation, then restore its offset after OpenTUI layout.

## Module Boundary

Place overlay conversion, ordering, lifecycle reduction, journaling, and refresh coordination in a focused module:

```text
context/data.tsx
    projected/live message reducers
    event routing
    hydration and refresh coordination
          |
          v
context/session-timeline.ts
    pending adapters
    lifecycle overlay operations
    visible timeline composition
    deterministic ordering
```

Do not move general message-event reduction into this module.

## Implementation Sequence

1. Add pure lifecycle adapter, reducer, and ordering functions with deterministic unit tests.
2. Add the overlay state and visible timeline accessors behind the existing data context.
3. Change admission and promotion handlers to mutate the overlay while preserving existing projected/live behavior where required during migration.
4. Implement sequential hydration, the narrow journal, and same-epoch refresh coalescing.
5. Change `createSessionRows` and `SessionRowView` lookup to consume the visible timeline.
6. Add stable IDs to all `SessionRow` variants and keyed row reconciliation.
7. Migrate only pending-sensitive route logic; leave projected-only consumers on `session.message`.
8. Remove the old pending-ID reconciliation helper and mixed pending insertion from projected hydration.
9. Run focused data/row tests, TUI typecheck, and the full TUI suite.

## Required Regressions

- Pending input known only through the pending endpoint.
- Promotion before pending read.
- Promotion between pending and projected reads.
- Promotion after projected read.
- Admission after pending read.
- Admission and promotion during hydration.
- Duplicate or inverted admission/promotion delivery.
- Projected representation wins over the same pending/promoted ID.
- Streaming text delta during hydration is applied exactly once.
- Concurrent same-Session refresh callers join.
- Different Sessions refresh concurrently.
- Old-epoch refresh cannot install after reconnect.
- Failed pending or projected read does not erase visible state.
- Pending-to-promoted-to-projected retains one stable row ID.
- Unaffected neighboring rows retain identity across full row reduction.
- Steer and queue ordering follows the selected policy.

## Explicit Non-Goals For This PR

- Replay general Session events.
- Redesign the 200-message pagination behavior.
- Change server APIs or event schemas.
- Introduce Effect into the TUI data layer.
- Add scroll anchoring without a failing regression.
- Migrate undo, fork, transcript, usage, and other projected-history consumers unless existing behavior requires pending visibility.

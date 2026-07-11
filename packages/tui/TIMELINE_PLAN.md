# Session Timeline Frontend Design

## Problem

The server exposes projected messages and pending work separately while live events may arrive during either read. The TUI must keep admitted work visible through hydration, promotion, reconnect, revert, and compaction without treating pending records as projected history.

The server contract remains unchanged.

## Model

Projected history stays in the message cache. Everything not yet projected lives in one overlay:

```ts
type SessionTimelineWork =
  | {
      kind: "input"
      id: string
      admittedSeq: number
      delivery: "steer" | "queue"
      message: SessionMessageInfo
    }
  | {
      kind: "promoted"
      id: string
      promotedSeq: number
      message?: SessionMessageInfo
    }
  | {
      kind: "compaction"
      id: string
      admittedSeq: number
    }
```

The variants prevent fabricated state:

- Admitted input has content, delivery, and admission order.
- Promotion-before-admission needs only its ID and promotion order.
- Queued compaction has no message payload or delivery mode.

The visible timeline is projected messages followed by non-projected overlay messages. Queued compaction is exposed as its own row kind.

## Hydration

Hydration reads pending work before projected history:

```ts
const pending = await api.session.pending.list({ sessionID })
const projected = await api.message.list({ sessionID })
```

Promotion atomically removes the pending record and inserts the projected message. Given pending read `P`, projected read `M`, and promotion `X`, with `P < M`:

- `X < P`: projected contains the input.
- `P < X < M`: projected wins by ID.
- `M < X`: pending contains the input and the promotion event retains it in the overlay.

Concurrent reads permit the unsafe order `M < X < P`, where both snapshots omit the input. Sequential reads eliminate it.

## Live Operations

Only topology operations are journaled during hydration:

```ts
type SessionTimelineOperation =
  | { type: "admitted"; work: SessionAdmittedWork }
  | { type: "promoted"; inputID: string; promotedSeq: number; created: number }
  | { type: "removed"; inputID: string }
  | { type: "reverted"; to: string }
```

The journal is folded onto the two server snapshots before installation. Projected IDs always win.

Text, reasoning, tool, shell, and compaction deltas are not replayed. They are additive, and projected responses expose no event watermark proving whether a delta is already included.

## Refresh Ownership

One refresh record per Session owns its promise, identity token, and topology journal.

- Same-Session callers join the active promise.
- Reconnect clears active records and starts replacements for every loaded, pending-only, or refreshing Session.
- Invalidated callers join the replacement refresh when one exists.
- Delete and committed revert remove the active record, preventing stale installation.
- Failed reads install nothing, preserving visible state.

No generation counters or durable client-side event log are required.

## Ordering

Overlay work is ordered by execution eligibility:

1. Promoted inputs awaiting projection.
2. Queued compaction barriers.
3. Steering inputs by `admittedSeq`.
4. Queued inputs by `admittedSeq`.

Projected history always precedes the overlay.

## Solid Identity

Every `SessionRow` has a stable semantic ID and rows are installed with:

```ts
setRows(reconcile(next, { key: "id" }))
```

The same durable input ID identifies:

- pending, promoted, and projected prompt rows;
- queued and running compaction rows.

Solid therefore moves or updates the existing row owner instead of remounting it. Existing sticky-bottom behavior remains responsible for following output; this change adds no scroll-position policy.

## Boundary

`session.message` remains projected-only. `session.timeline` composes projected history with the overlay for rendering and pending-aware interactions. The public `session.input` queries are compatibility views over admitted input variants.

This design guarantees pending-work visibility under the existing atomic-promotion, ordered-live-connection, and reconnect contracts. Recovering arbitrary silently dropped streaming events would require a server snapshot cursor or replay API.

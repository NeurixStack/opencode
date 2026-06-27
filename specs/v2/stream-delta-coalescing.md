# Stream Delta Coalescing PRD

Status: Draft

## Summary

OpenCode should coalesce provider text and reasoning stream fragments before
publishing UI-facing live delta events. Some providers emit very small,
high-frequency `text-delta` and `reasoning-delta` chunks. Forwarding each chunk
as its own Session event keeps the transcript semantically correct, but it burns
CPU in the server, SDK client, app/TUI reducers, and renderer for no product
benefit. The product should preserve the feeling of live typing while reducing
publication and render cadence to a bounded, observable rate.

The core change is to batch live-only text-like deltas per active content block
and flush them on time, size, or semantic boundaries. Durable replay boundaries
and final full-value events stay unchanged.

## Problem

Current stream handling forwards tiny provider fragments nearly one-for-one:

- LLM providers emit raw `text-delta` and `reasoning-delta` events.
- The legacy Session processor appends the text to in-memory part state and
  immediately publishes `message.part.delta` through `Session.updatePartDelta`.
- V2 exposes live-only `session.next.text.delta` and
  `session.next.reasoning.delta`; replayable `*.ended` events carry the final
  full text.
- App, TUI, ACP, SDK, and command-run consumers often reduce or render every
  delta event.

For providers that stream larger chunks this feels fine. For providers that emit
many tiny fragments, the same logical answer can create much higher event rate,
more websocket/SSE churn, more reducer work, more Solid/DOM/OpenTUI updates, and
lower perceived FPS.

## Goals

- Cap UI-facing text/reasoning delta cadence without losing the live streaming
  feel.
- Preserve existing event schemas and client compatibility.
- Preserve exact transcript text, order, metadata boundaries, and replay
  behavior.
- Reduce event count and renderer work for tiny-fragment providers by at least
  80% in bursty cases.
- Keep first-visible-output latency low enough that sessions still feel alive.
- Make coalescing observable and safe to tune per surface.

## Non-goals

- Do not ask providers to change their streaming behavior.
- Do not make live deltas durable or replayable.
- Do not change final assistant text/reasoning content.
- Do not delay tool calls, permission prompts, step finish, errors, or
  interruption settlement behind text batching.
- Do not remove client-side rendering optimizations; server coalescing is the
  first layer, not the only possible layer.
- Do not redesign the typing animation or markdown renderer in this slice.

## Product Requirements

### P0: Semantics and compatibility

- Existing event names and payload shapes remain valid:
  - legacy `message.part.delta`
  - V2 `session.next.text.delta`
  - V2 `session.next.reasoning.delta`
- A coalesced delta is only the concatenation of adjacent deltas for the same
  Session, assistant message, content block, and field.
- Event order relative to non-coalesced events is preserved. Before publishing a
  boundary event for a block, pending text for that block must be flushed or
  represented by the boundary's full-value event.
- `session.next.text.ended` and `session.next.reasoning.ended` remain the
  replayable source of final text for V2. Legacy `message.part.updated`
  continues to carry the full final part.
- Reconnect and history replay behavior does not depend on receiving live
  deltas.

### P0: Responsiveness

- First visible text/reasoning for a new block should normally publish within
  75 ms of the first provider delta.
- While a block is actively receiving tiny deltas, publish at no more than about
  30 deltas per second per active block by default.
- Flush earlier when a pending buffer reaches a size threshold, initially 512 to
  1024 UTF-16 code units.
- Flush immediately before:
  - `text-end` / `reasoning-end`
  - tool input start or tool call publication for the same assistant turn
  - step finish or step failure
  - stream interruption, cancellation, or provider error
  - session drain cleanup

### P1: Adaptive behavior

- Large provider chunks should pass through with little or no additional delay.
- Reasoning may use the same default cadence as text initially, but the design
  should allow a slower reasoning cadence later when reasoning is collapsed or
  visually deprioritized.
- A Session with multiple active text/reasoning blocks coalesces each block
  independently so one block does not starve another.
- Coalescing should be runtime-tunable without schema changes.

### P1: Observability

Add counters and histograms around coalescing:

- raw delta count and bytes by provider/model/event kind
- published delta count and bytes by event kind
- coalesced ratio by provider/model/event kind
- flush reason: `first`, `time`, `size`, `boundary`, `shutdown`
- time spent buffered before publication
- maximum pending buffer size per active Session

These metrics should make it possible to compare provider behavior and verify
that UI-facing event rate stays bounded.

## Proposed Design

### Coalesce at the server stream-publication boundary

The preferred boundary is after provider parsing has produced canonical LLM
stream events and before those events are published to Session subscribers.
Provider adapters should continue emitting canonical raw deltas. Clients should
continue consuming the existing Session event schema. The coalescer sits in the
Session processing path so every client benefits.

For legacy runtime, this means replacing immediate `Session.updatePartDelta(...)`
publication for `text-delta` and `reasoning-delta` with an append to a per-part
coalescer. The processor still updates its in-memory accumulated part text
immediately so final `message.part.updated` content is correct.

For V2 runtime, apply the same policy to live-only
`session.next.text.delta` and `session.next.reasoning.delta`. The comments in
`packages/schema/src/session-event.ts` already define these deltas as live-only,
with `*.ended` as the replayable full-value boundary, so batching them does not
change durable replay semantics.

### Buffer key

Each pending buffer is keyed by the minimum identity needed to preserve order:

```text
sessionID
assistantMessageID
part/content-block ID
field/event kind: text or reasoning
```

The buffer stores:

```text
text: accumulated delta string
firstDeltaAt
lastDeltaAt
flushTimer
sequence guard for stale timers
latest provider metadata only when the target event supports it
```

### Flush policy

Use three flush triggers:

1. First-delta timer: schedule the first flush for a new buffer at about 50 ms.
2. Cadence timer: after each flush, schedule the next flush at about 33 ms while
   more deltas arrive.
3. Size threshold: flush immediately when the pending text reaches 512 to 1024
   UTF-16 code units.

Boundary events synchronously drain relevant buffers before they publish. Global
cleanup drains every pending buffer for that Session drain.

### Client-side follow-up

Server coalescing should be enough to solve the high event-rate problem for all
clients. If app or TUI FPS is still poor after server batching, add a second
client-side render scheduler that folds multiple already-received deltas into
one state update per animation frame. That follow-up should not replace server
coalescing because it would still leave network, decode, and reducer overhead in
place.

## Edge Cases

- **Out-of-order timers:** Flush timers must be guarded so an old timer cannot
  publish an already-drained buffer.
- **Interrupted streams:** Drain pending buffers during cleanup before surfacing
  interruption or provider failure status.
- **Provider metadata on deltas:** Metadata updates that only affect final part
  state should keep updating the in-memory part immediately; boundary full-value
  events publish the final metadata. Do not invent metadata fields on delta
  schemas that do not currently have them.
- **Unicode:** Coalescing concatenates provider strings exactly in receipt order.
  It must not trim, normalize, or split by grapheme.
- **Backpressure:** A long blocked subscriber should not grow unbounded per-block
  buffers. Size threshold and Session cleanup provide the first bound; add a
  hard cap if instrumentation shows pathological growth.
- **Tool calls:** Text/reasoning buffers must flush before tool events that make
  the assistant turn appear to move on to another phase.

## Rollout Plan

1. Add instrumentation around raw and published text/reasoning deltas without
   changing behavior.
2. Implement the shared coalescer behind a runtime flag, default off locally if
   needed for verification.
3. Enable it for legacy `message.part.delta` publication and add unit tests for
   time, size, boundary, and interruption flushes.
4. Enable it for V2 live-only deltas and add reducer/replay tests proving final
   `*.ended` replay remains sufficient.
5. Turn the flag on by default once event-rate metrics and interactive smoke
   tests show bounded cadence and unchanged final output.
6. Remove the flag after one release cycle if no compatibility issue appears.

## Acceptance Criteria

- A synthetic stream of 1,000 one-character text deltas publishes at least 80%
  fewer UI-facing delta events while final text remains byte-for-byte identical.
- The same synthetic stream emits first visible text within 75 ms in local tests.
- A stream that ends immediately after a few tiny deltas publishes the full text
  by the end boundary without waiting for the timer.
- Reasoning deltas follow the same order and final-value guarantees as text.
- Tool calls, permission prompts, failures, and step completion are not delayed
  behind a pending text/reasoning timer.
- Existing SDK-generated event types do not change.
- History/replay tests pass without relying on live deltas.
- Interactive TUI/app smoke tests show smoother output for tiny-fragment streams
  and no visibly worse responsiveness for normal streams.

## Open Questions

- Should default cadence be 30 Hz, 20 Hz, or adaptive based on measured renderer
  cost?
- Should reasoning use a slower default cadence when hidden or collapsed?
- Should coalescing thresholds be configured globally, per provider/model, or
  only through runtime flags?
- Where should long-term metrics live: runtime logs, existing stats, or a
  dedicated performance counter surface?

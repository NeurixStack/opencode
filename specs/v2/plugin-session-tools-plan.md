# Plugin Session and Tool Architecture Prototype

## Goal

Let V2 plugins access a normal session API and define tools through plugin transforms without introducing application-vs-location tools or a `Session -> LocationServiceMap -> Plugin -> Session` construction cycle.

## Recommended direction

Keep location-scoped services. Split location-specific session behavior out of the global session data service.

- `SessionV2.Service` remains global and owns session data APIs:
  - `create`
  - `get`
  - `list`
  - `messages`
  - `message`
  - `context`
  - `events`
  - `history`
  - metadata-only updates such as `rename`, `switchAgent`, `switchModel`
- Add a location-scoped session runtime service for behavior that touches location services:
  - `prompt`
  - `resume`
  - `wait`
  - `interrupt`
  - `active`
  - `revert.stage`
  - `revert.clear`
  - any future runner/filesystem/snapshot-coupled session operation

This keeps the dependency rule simple:

```txt
global services do not call location services
location services may call global services
```

## Why

The current V2 shape becomes cyclic if `PluginHost` gets full `ctx.session` while `SessionV2.Service` depends on `LocationServiceMap`:

```txt
SessionV2
-> LocationServiceMap
-> LocationRuntime
-> PluginService
-> PluginHost
-> SessionV2
```

The prototype in `plugin-session-cycle.prototype.ts` recreates this red case and compares green alternatives.

## Ideal plugin call site

Plugin authors should not see the split. The host composes global session data plus location session runtime into one `ctx.session` API:

```ts
export const Plugin = define({
  id: "subagent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.tool.transform((draft) => {
      draft.set("subagent", tool({
        description,
        input: Input,
        output: Output,
        execute: Effect.fn(function* (input, call) {
          const parent = yield* ctx.session.get(call.sessionID)
          const child = yield* ctx.session.create({
            parentID: parent.id,
            title: input.description,
            agent: input.agent,
          })

          yield* ctx.session.prompt({
            sessionID: child.id,
            prompt: { text: input.prompt },
            resume: false,
          })
          yield* ctx.session.resume(child.id)
          yield* ctx.session.wait(child.id)

          return {
            sessionID: child.id,
            status: "completed",
            output: yield* ctx.session.finalText(child.id),
          }
        }),
      }))
    })
  }),
})
```

## Tool model

Tools stay location-scoped. There should not be public application tools or global tools.

Plugins boot per location, and tools are contributed through transforms:

```ts
yield* ctx.tool.transform((draft) => {
  draft.set("repo_summary", tool({ description, input, output, execute }))
})
```

The SDK should be implemented as one plugin instance: it receives a plugin host/context internally, and SDK methods call the host methods. Therefore an SDK-registered tool is just a plugin tool transform applied as each location boots.

## Concrete implementation slices

1. Add `packages/core/src/session/runtime.ts` as a location node. **Implemented in this draft.**
2. Move `prompt`, `resume`, `wait`, `interrupt`, `active`, and location-sensitive `revert` operations from `SessionV2.Service` into the runtime service. **Implemented in this draft for the new runtime path; old `SessionV2` entrypoints are left as compatibility stubs and should be removed once callers migrate.**
3. Update server route handlers to route location-sensitive requests at the API boundary by resolving the session location and providing that location runtime. **Implemented in this draft.**
4. Add `ctx.session` to `PluginHost` by composing `SessionV2.Service` and the location session runtime. **Implemented in this draft.**
5. Add public plugin `ctx.tool.transform` types and adapt it to the existing canonical core `Tool.make` representation.
6. Convert `ToolRegistry` registration to transform/rebuild semantics.
7. Port `subagent` to a built-in plugin that registers a normal location tool.
8. Remove `ApplicationTools` once no built-in tool requires process-global registration.

## Invariants to preserve

- A tool materialization snapshots executable tool identity; stale calls fail.
- Tool output bounding remains centralized in `ToolRegistry.Materialization.settle`.
- Location session runtime asserts that the target session belongs to the current location before running location-sensitive operations.
- Public HTTP/SDK API shape does not need to change.

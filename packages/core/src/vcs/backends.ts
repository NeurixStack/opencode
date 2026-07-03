export * as VcsBackends from "./backends"

import { Vcs } from "@opencode-ai/plugin/v2/effect"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus } from "@opencode-ai/schema/vcs"
import { Context, Effect, Exit, Layer, Option, Schema } from "effect"
import type { Scope } from "effect"
import { ConfigVcs } from "../config/vcs"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"

export interface Interface {
  readonly register: (backend: Vcs.Backend) => Effect.Effect<void, Vcs.RegistrationError, Scope.Scope>
  readonly get: (type: string) => Vcs.Adapter | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/VcsBackends") {}

const decodeType = Schema.decodeUnknownOption(ConfigVcs.Type)
const decodeStatus = Schema.decodeUnknownOption(Schema.Array(FileStatus))
const decodeDiff = Schema.decodeUnknownOption(Schema.Array(FileDiff.Info))

interface Entry {
  readonly backend: Vcs.Backend
  adapter?: Vcs.Adapter
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = new Map<string, Entry>()

    return Service.of({
      register: (backend) =>
        Effect.gen(function* () {
          if (Option.isNone(decodeType(backend.type))) {
            return yield* new Vcs.RegistrationError({
              type: backend.type,
              message: `Invalid vcs backend type '${backend.type}'`,
            })
          }
          if (registry.has(backend.type)) {
            return yield* new Vcs.RegistrationError({
              type: backend.type,
              message: `Vcs backend '${backend.type}' is already registered`,
            })
          }
          registry.set(backend.type, { backend })
          yield* Effect.addFinalizer(() => Effect.sync(() => registry.delete(backend.type)))
        }),
      get: (type) => {
        const vcs = location.vcs
        const entry = registry.get(type)
        if (!entry || vcs?.type !== type) return undefined
        entry.adapter ??= guard(type, () =>
          entry.backend.make({
            directory: location.directory,
            worktree: location.project.directory,
            store: vcs.store,
          }),
        )
        return entry.adapter
      },
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer: layer, deps: [Location.node] })

function guard(type: string, make: () => Vcs.Adapter): Vcs.Adapter {
  let underlying: Vcs.Adapter | undefined
  const adapter = Effect.sync(() => (underlying ??= make()))
  return {
    status: () => adapter.pipe(Effect.flatMap((impl) => impl.status()), sanitize(type, "status", decodeStatus)),
    diff: (mode, options) =>
      adapter.pipe(
        Effect.flatMap((impl) => impl.diff(mode, options)),
        sanitize(type, "diff", decodeDiff),
      ),
  }
}

function sanitize<A>(type: string, operation: string, decode: (input: unknown) => Option.Option<readonly A[]>) {
  return <E, R>(effect: Effect.Effect<readonly A[], E, R>) =>
    effect.pipe(
      Effect.exit,
      Effect.flatMap((exit) => {
        if (Exit.isFailure(exit)) {
          return Effect.logWarning("vcs backend failed", { type, operation, cause: exit.cause }).pipe(
            Effect.as([] as readonly A[]),
          )
        }
        return Option.match(decode(exit.value), {
          onNone: () =>
            Effect.logWarning("vcs backend returned invalid data", { type, operation }).pipe(
              Effect.as([] as readonly A[]),
            ),
          onSome: (value) => Effect.succeed(value),
        })
      }),
    )
}

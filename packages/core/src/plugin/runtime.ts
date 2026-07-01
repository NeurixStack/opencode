export * as PluginRuntime from "./runtime"

import { Context, Deferred, Effect, Layer } from "effect"
import { AgentV2 } from "../agent"
import { makeGlobalNode } from "../effect/app-node"
import { Job } from "../job"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { SessionV2 } from "../session"

export interface Interface {
  readonly session: Pick<
    SessionV2.Interface,
    "get" | "create" | "messages" | "prompt" | "resume" | "interrupt" | "synthetic"
  >
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel">
  readonly location: {
    readonly agent: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: AgentV2.Info[] }>
    }
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginRuntime") {}

export interface Bridge {
  runtime: Deferred.Deferred<Interface>
}

export const makeBridge = (): Bridge => ({ runtime: Deferred.makeUnsafe<Interface>() })

const require = <A, E, R>(bridge: Bridge, f: (runtime: Interface) => Effect.Effect<A, E, R>) =>
  Effect.suspend(() => Deferred.await(bridge.runtime).pipe(Effect.flatMap(f)))

export const layerWithBridge = (bridge: Bridge) =>
  Layer.succeed(
    Service,
    Service.of({
      session: {
        get: (sessionID) => require(bridge, (runtime) => runtime.session.get(sessionID)),
        create: (input) => require(bridge, (runtime) => runtime.session.create(input)),
        messages: (input) => require(bridge, (runtime) => runtime.session.messages(input)),
        prompt: (input) => require(bridge, (runtime) => runtime.session.prompt(input)),
        resume: (sessionID) => require(bridge, (runtime) => runtime.session.resume(sessionID)),
        interrupt: (sessionID) => require(bridge, (runtime) => runtime.session.interrupt(sessionID)),
        synthetic: (input) => require(bridge, (runtime) => runtime.session.synthetic(input)),
      },
      job: {
        start: (input) => require(bridge, (runtime) => runtime.job.start(input)),
        wait: (input) => require(bridge, (runtime) => runtime.job.wait(input)),
        block: (input) => require(bridge, (runtime) => runtime.job.block(input)),
        background: (id) => require(bridge, (runtime) => runtime.job.background(id)),
        cancel: (id) => require(bridge, (runtime) => runtime.job.cancel(id)),
      },
      location: {
        agent: {
          list: (ref) => require(bridge, (runtime) => runtime.location.agent.list(ref)),
        },
      },
    }),
  )

export const providerLayerWithBridge = (bridge: Bridge) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const jobs = yield* Job.Service
      const locations = yield* LocationServiceMap.Service
      const runtime: Interface = {
        session: sessions,
        job: jobs,
        location: {
          agent: {
            list: (ref) =>
              Effect.gen(function* () {
                const location = yield* Location.Service
                const agents = yield* AgentV2.Service
                return {
                  location: new Location.Info({
                    directory: location.directory,
                    workspaceID: location.workspaceID,
                    project: location.project,
                  }),
                  data: yield* agents.list(),
                }
              }).pipe(Effect.provide(locations.get(ref)), Effect.orDie),
          },
        },
      }
      yield* Deferred.succeed(bridge.runtime, runtime)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          bridge.runtime = Deferred.makeUnsafe<Interface>()
        }),
      )
    }),
  )

const unsafeBridge = makeBridge()

export const layer = layerWithBridge(unsafeBridge)
export const providerLayer = providerLayerWithBridge(unsafeBridge)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export const nodeWithBridge = (bridge: Bridge) =>
  makeGlobalNode({ service: Service, layer: layerWithBridge(bridge), deps: [] })

export const providerNode = makeGlobalNode({
  name: "plugin-runtime-provider",
  layer: providerLayer,
  deps: [node, SessionV2.node, Job.node, LocationServiceMap.node],
})

export const providerNodeWithBridge = (bridge: Bridge) =>
  makeGlobalNode({
    name: "plugin-runtime-provider",
    layer: providerLayerWithBridge(bridge),
    deps: [node, SessionV2.node, Job.node, LocationServiceMap.node],
  })

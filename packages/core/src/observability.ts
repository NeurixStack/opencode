export * as Observability from "./observability"

import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "./effect/layer-node"
import { Cause, Effect, Layer, Logger, References } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { OtlpSerialization } from "effect/unstable/observability"
import { Logging } from "./observability/logging"
import { Otlp } from "./observability/otlp"

const references = Layer.mergeAll(
  Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel()),
  Layer.succeed(References.TracerEnabled, false),
  Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
  Layer.succeed(HttpClient.TracerPropagationEnabled, false),
)

const local = Logger.layer(Logging.loggers(), { mergeWithExisting: false }).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.orDie,
  Layer.merge(references),
)

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const logs = Logger.layer([...Logging.loggers(), ...Otlp.loggers()], { mergeWithExisting: false }).pipe(
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
      Layer.orDie,
      Layer.merge(references),
    )
    return Layer.merge(logs, yield* Otlp.tracingLayer)
  }),
).pipe(Layer.catchCause((cause) => (Cause.hasInterrupts(cause) ? Layer.effectDiscard(Effect.failCause(cause)) : local)))

export const node = LayerNode.make({ name: "observability", layer, deps: [] })

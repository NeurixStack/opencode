import { Effect, Layer } from "effect"
import { OtlpLogger } from "effect/unstable/observability"
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_OPENCODE_CLIENT,
  ATTR_OPENCODE_RUN,
  ATTR_SERVICE_INSTANCE_ID,
} from "./semconv"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { runID } from "./shared"

const endpoint = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
let installedContextManager: { readonly manager: { disable(): unknown }; references: number } | undefined

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, entry) => {
        const [key, ...value] = entry.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

function resourceAttributes() {
  const value = process.env.OTEL_RESOURCE_ATTRIBUTES
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

export function resource(): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  const attributes = resourceAttributes()
  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...attributes,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: attributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME] ?? InstallationChannel,
      [ATTR_OPENCODE_CLIENT]: Flag.OPENCODE_CLIENT,
      [ATTR_OPENCODE_RUN]: runID,
      [ATTR_SERVICE_INSTANCE_ID]: runID,
    },
  }
}

export function loggers() {
  if (!endpoint) return []
  return [OtlpLogger.make({ url: `${endpoint}/v1/logs`, resource: resource(), headers })]
}

export const tracingLayer = Effect.gen(function* () {
  if (!endpoint) return Layer.empty
  const NodeSdk = yield* Effect.promise(() => import("@effect/opentelemetry/NodeSdk"))
  const OTLP = yield* Effect.promise(() => import("@opentelemetry/exporter-trace-otlp-http"))
  const SdkBase = yield* Effect.promise(() => import("@opentelemetry/sdk-trace-base"))
  const { AsyncLocalStorageContextManager } = yield* Effect.promise(() => import("@opentelemetry/context-async-hooks"))
  const { context } = yield* Effect.promise(() => import("@opentelemetry/api"))

  const contextManager = Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        // The Effect Node SDK does not register a global context manager, but the AI SDK uses it to parent spans.
        if (installedContextManager) {
          installedContextManager.references += 1
          return { installed: true, manager: installedContextManager.manager }
        }
        const manager = new AsyncLocalStorageContextManager().enable()
        const installed = context.setGlobalContextManager(manager)
        if (!installed) manager.disable()
        if (installed) installedContextManager = { manager, references: 1 }
        return { installed, manager }
      }),
      ({ installed, manager }) =>
        Effect.sync(() => {
          if (!installed) return
          if (installedContextManager?.manager !== manager) return
          installedContextManager.references -= 1
          if (installedContextManager.references > 0) return
          installedContextManager = undefined
          context.disable()
          manager.disable()
        }),
    ),
  )

  return Layer.merge(
    contextManager,
    NodeSdk.layer(() => ({
      resource: resource(),
      spanProcessor: new SdkBase.BatchSpanProcessor(
        new OTLP.OTLPTraceExporter({
          url: `${endpoint}/v1/traces`,
          headers,
        }),
      ),
    })),
  )
})

export * as Otlp from "./otlp"

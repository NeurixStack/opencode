import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@opencode-ai/httpapi-codegen"
import {
  ClientApi,
  effectOmitEndpoints,
  endpointNames,
  groupNames,
  promiseOmitEndpoints,
} from "@opencode-ai/protocol/client"
import { SessionsCursor } from "@opencode-ai/protocol/groups/session"
import { Agent } from "@opencode-ai/schema/agent"
import { Command } from "@opencode-ai/schema/command"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { EventLog } from "@opencode-ai/schema/event-log"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Form } from "@opencode-ai/schema/form"
import { Integration } from "@opencode-ai/schema/integration"
import { LLM } from "@opencode-ai/schema/llm"
import { Location } from "@opencode-ai/schema/location"
import { Mcp } from "@opencode-ai/schema/mcp"
import { Model } from "@opencode-ai/schema/model"
import { Permission } from "@opencode-ai/schema/permission"
import { PermissionSaved } from "@opencode-ai/schema/permission-saved"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Project } from "@opencode-ai/schema/project"
import { ProjectCopy } from "@opencode-ai/schema/project-copy"
import { AgentAttachment, FileAttachment, Prompt, Source } from "@opencode-ai/schema/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Provider } from "@opencode-ai/schema/provider"
import { Pty } from "@opencode-ai/schema/pty"
import { PtyTicket } from "@opencode-ai/schema/pty-ticket"
import { Question } from "@opencode-ai/schema/question"
import { Reference } from "@opencode-ai/schema/reference"
import { Revert } from "@opencode-ai/schema/revert"
import { AbsolutePath, RelativePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionContextEntry } from "@opencode-ai/schema/session-context-entry"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionInput } from "@opencode-ai/schema/session-input"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Shell } from "@opencode-ai/schema/shell"
import { Skill } from "@opencode-ai/schema/skill"
import { Vcs } from "@opencode-ai/schema/vcs"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints: promiseOmitEndpoints })
const effectContract = compile(ClientApi, { groupNames, endpointNames, omitEndpoints: effectOmitEndpoints })
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@opencode-ai/schema/agent", Agent),
  ...namespaceTypes("Command", "@opencode-ai/schema/command", Command),
  ...namespaceTypes("Credential", "@opencode-ai/schema/credential", Credential),
  ...namespaceTypes("Event", "@opencode-ai/schema/event", Event),
  ...namespaceTypes("EventLog", "@opencode-ai/schema/event-log", EventLog),
  ...namespaceTypes("EventManifest", "@opencode-ai/schema/event-manifest", EventManifest),
  ...namespaceTypes("FileDiff", "@opencode-ai/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@opencode-ai/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@opencode-ai/schema/form", Form),
  ...namespaceTypes("Integration", "@opencode-ai/schema/integration", Integration),
  ...namespaceTypes("LLM", "@opencode-ai/schema/llm", LLM),
  ...namespaceTypes("Location", "@opencode-ai/schema/location", Location),
  ...namespaceTypes("Mcp", "@opencode-ai/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@opencode-ai/schema/model", Model),
  ...namespaceTypes("Permission", "@opencode-ai/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@opencode-ai/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@opencode-ai/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@opencode-ai/schema/project", Project),
  ...namespaceTypes("ProjectCopy", "@opencode-ai/schema/project-copy", ProjectCopy),
  ...namespaceTypes("PromptInput", "@opencode-ai/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@opencode-ai/schema/provider", Provider),
  ...namespaceTypes("Pty", "@opencode-ai/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@opencode-ai/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@opencode-ai/schema/question", Question),
  ...namespaceTypes("Reference", "@opencode-ai/schema/reference", Reference),
  ...namespaceTypes("Revert", "@opencode-ai/schema/revert", Revert),
  ...namespaceTypes("Session", "@opencode-ai/schema/session", Session),
  ...namespaceTypes("SessionContextEntry", "@opencode-ai/schema/session-context-entry", SessionContextEntry),
  ...namespaceTypes("SessionInput", "@opencode-ai/schema/session-input", SessionInput),
  ...namespaceTypes("SessionMessage", "@opencode-ai/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionEvent", "@opencode-ai/schema/session-event", SessionEvent, {
    Durable: "DurableEvent",
    All: "Event",
  }),
  ...namespaceTypes("Shell", "@opencode-ai/schema/shell", Shell),
  ...namespaceTypes("Skill", "@opencode-ai/schema/skill", Skill),
  ...namespaceTypes("Vcs", "@opencode-ai/schema/vcs", Vcs),
  ...namespaceTypes("Workspace", "@opencode-ai/schema/workspace", Workspace),
  typeReference("Prompt", "@opencode-ai/schema/prompt", Prompt),
  typeReference("Source", "@opencode-ai/schema/prompt", Source),
  typeReference("FileAttachment", "@opencode-ai/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@opencode-ai/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@opencode-ai/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@opencode-ai/schema/schema", RelativePath),
  typeReference("SessionsCursor", "@opencode-ai/protocol/groups/session", SessionsCursor),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          outputTypes: {
            "events.subscribe": {
              name: "OpenCodeEventEncoded",
              import: 'import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, { module: "../../contract", api: "ClientApi" }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          typeReferences: effectTypeReferences,
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object, names?: Readonly<Record<string, string>>) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${names?.[name] ?? name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}

import { SessionV2 } from "@opencode-ai/core/session"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Layer } from "effect"
import { layer as v2LocationLayer } from "./groups/v2/location"
import { messageHandlers } from "./handlers/v2/message"
import { modelHandlers } from "./handlers/v2/model"
import { providerHandlers } from "./handlers/v2/provider"
import { sessionHandlers } from "./handlers/v2/session"
import { permissionHandlers, savedPermissionHandlers, sessionPermissionHandlers } from "./handlers/v2/permission"
import { fileSystemHandlers } from "./handlers/v2/fs"
import { commandHandlers } from "./handlers/v2/command"
import { skillHandlers } from "./handlers/v2/skill"
import { eventHandlers } from "./handlers/v2/event"
import { agentHandlers } from "./handlers/v2/agent"
import { healthHandlers } from "./handlers/v2/health"

export const v2Handlers = Layer.mergeAll(
  healthHandlers,
  agentHandlers,
  sessionHandlers,
  messageHandlers,
  modelHandlers,
  providerHandlers,
  permissionHandlers,
  sessionPermissionHandlers,
  savedPermissionHandlers,
  fileSystemHandlers,
  commandHandlers,
  skillHandlers,
  eventHandlers,
).pipe(
  Layer.provide(v2LocationLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(PermissionSaved.layer),
  Layer.provide(SessionV2.defaultLayer),
)

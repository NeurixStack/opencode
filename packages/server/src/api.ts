import { makeDefaultApi } from "@opencode-ai/protocol/api"
import { LocationMiddleware, SessionLocationMiddleware } from "./middleware/location.js"

export const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

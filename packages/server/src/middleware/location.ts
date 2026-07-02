import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode/HttpApiLocation",
) {}

export class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode/HttpApiSessionLocation",
  {
    error: [InvalidRequestError, SessionNotFoundError],
  },
) {}

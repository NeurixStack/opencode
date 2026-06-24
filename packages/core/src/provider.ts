export * as ProviderV2 from "./provider"

import { Types } from "effect"
import { Provider } from "@opencode-ai/schema/provider"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const Request = Provider.Request
export type Request = Provider.Request

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = Types.DeepMutable<Info>

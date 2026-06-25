export * as ProviderV2 from "./provider"

import { Provider } from "@opencode-ai/schema/provider"
import type { DeepMutable } from "./schema"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK_PREFIX = "aisdk:"
export const isAISDK = (packageName: string | undefined) => packageName?.startsWith(AISDK_PREFIX) ?? false
export const aisdk = (packageName: string) => (isAISDK(packageName) ? packageName : `${AISDK_PREFIX}${packageName}`)
export const packageName = (packageName: string | undefined) =>
  isAISDK(packageName) ? packageName!.slice(AISDK_PREFIX.length) : packageName

export const Request = Provider.Request
export type Request = Provider.Request

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

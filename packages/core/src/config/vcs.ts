export * as ConfigVcs from "./vcs"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { FSUtil } from "../fs-util"

const RESERVED = new Set(["git", "hg"])

export const Type = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/)).check(
  Schema.makeFilter<string>((value) =>
    RESERVED.has(value) ? `'${value}' has built-in detection and cannot be redeclared` : undefined,
  ),
)

const Marker = Schema.String.check(
  Schema.makeFilter<string>((value) => {
    if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
      return `marker must be a single path segment such as ".jj"`
    }
    return undefined
  }),
)

export class Backend extends Schema.Class<Backend>("ConfigV2.Vcs.Backend")({
  marker: Marker.annotate({
    description: 'Directory name that marks a repository root for this backend, such as ".jj"',
  }),
}) {}

export const Info = Schema.Record(Type, Backend).check(
  Schema.makeFilter<Readonly<Record<string, Backend>>>((value) => {
    const markers = Object.values(value).map((backend) => backend.marker)
    return new Set(markers).size === markers.length ? undefined : "vcs backends must declare distinct markers"
  }),
)
export type Info = typeof Info.Type

const decode = Schema.decodeUnknownOption(Schema.Struct({ vcs: Info.pipe(Schema.optional) }), {
  onExcessProperty: "ignore",
})

export const readGlobal = Effect.fnUntraced(function* (fs: FSUtil.Interface, configDirectory: string) {
  const backends = new Map<string, Backend>()
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const text = yield* fs
      .readFileStringSafe(path.join(configDirectory, name))
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!text) continue
    const errors: ParseError[] = []
    const input: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length) continue
    const info = Option.getOrUndefined(decode(input))?.vcs
    for (const [type, backend] of Object.entries(info ?? {})) backends.set(type, backend)
  }
  return backends
})

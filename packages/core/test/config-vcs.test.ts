import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { ConfigVcs } from "@opencode-ai/core/config/vcs"

const decode = Schema.decodeUnknownOption(ConfigVcs.Info)

describe("ConfigVcs", () => {
  test("accepts backend declarations keyed by type", () => {
    const result = Option.getOrUndefined(decode({ jj: { marker: ".jj" } }))
    expect(result?.["jj"]?.marker).toBe(".jj")
  })

  test("rejects reserved built-in types", () => {
    expect(Option.isNone(decode({ git: { marker: ".mygit" } }))).toBe(true)
    expect(Option.isNone(decode({ hg: { marker: ".myhg" } }))).toBe(true)
  })

  test("rejects invalid type slugs", () => {
    expect(Option.isNone(decode({ "Not A Slug": { marker: ".x" } }))).toBe(true)
    expect(Option.isNone(decode({ "9starts-with-digit": { marker: ".x" } }))).toBe(true)
  })

  test("rejects markers that are not a single path segment", () => {
    expect(Option.isNone(decode({ jj: { marker: "" } }))).toBe(true)
    expect(Option.isNone(decode({ jj: { marker: ".." } }))).toBe(true)
    expect(Option.isNone(decode({ jj: { marker: "a/b" } }))).toBe(true)
  })

  test("rejects duplicate markers across types", () => {
    expect(Option.isNone(decode({ jj: { marker: ".x" }, piper: { marker: ".x" } }))).toBe(true)
    expect(Option.isSome(decode({ jj: { marker: ".jj" }, piper: { marker: ".piper" } }))).toBe(true)
  })
})

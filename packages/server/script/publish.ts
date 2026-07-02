#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  private?: boolean
  files?: Array<string>
  scripts?: Record<string, string>
  dependencies: Record<string, string>
  devDependencies?: Record<string, string>
  exports: Record<string, unknown>
}
const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`

if ((await $`npm view ${pkg.name}@${pkg.version} version`.nothrow()).exitCode === 0) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
  process.exit(0)
}

try {
  await $`rm -rf dist`
  await $`bun run build:publish`
  delete pkg.private
  delete pkg.scripts
  delete pkg.devDependencies
  pkg.files = ["dist"]
  pkg.exports = {
    "./api": {
      import: "./dist/api.js",
      types: "./dist/api.d.ts",
    },
  }
  pkg.dependencies = {
    "@opencode-ai/protocol": pkg.dependencies["@opencode-ai/protocol"],
    effect: pkg.dependencies.effect,
  }
  await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
  await rm(tarball, { force: true })
  await $`bun pm pack`
  await $`npm publish ${tarball} --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", originalText)
  await rm(tarball, { force: true })
}

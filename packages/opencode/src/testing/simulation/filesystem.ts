import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Glob } from "@opencode-ai/core/util/glob"
import { Effect, FileSystem, Layer, Option, Stream } from "effect"
import { badArgument, systemError, type PlatformError } from "effect/PlatformError"
import { InMemoryFs } from "just-bash"
import path from "path"

export interface Options {
  readonly root: string
  readonly files?: Record<string, string | Uint8Array>
  readonly fs?: InMemoryFs
}

const unsupported = (method: string) =>
  badArgument({
    module: "SimulationFileSystem",
    method,
    description: "Operation is not supported by the simulated filesystem",
  })

const permissionDenied = (method: string, file: string) =>
  systemError({
    _tag: "PermissionDenied",
    module: "SimulationFileSystem",
    method,
    description: "Path is outside the simulated filesystem root",
    pathOrDescriptor: file,
  })

const failure = (method: string, file: string, cause: unknown) =>
  systemError({
    _tag: String(cause).toLowerCase().includes("exist") ? "AlreadyExists" : "NotFound",
    module: "SimulationFileSystem",
    method,
    description: cause instanceof Error ? cause.message : String(cause),
    pathOrDescriptor: file,
  })

export function make(options: Options) {
  const fs = options.fs ?? new InMemoryFs()
  const root = path.resolve(options.root)
  const temp = { value: 0 }

  const normalize = (method: string, file: string): string | PlatformError => {
    const resolved = path.resolve(root, file)
    if (resolved === root || AppFileSystem.contains(root, resolved)) return resolved
    return permissionDenied(method, file)
  }

  const normalizeEffect = (method: string, file: string) => {
    const normalized = normalize(method, file)
    if (typeof normalized === "string") return Effect.succeed(normalized)
    return Effect.fail(normalized)
  }

  const normalizeSearchStart = (file: string) => {
    const resolved = path.resolve(root, file)
    if (resolved === root || AppFileSystem.contains(root, resolved)) return resolved
  }

  const normalizePair = (method: string, fromPath: string, toPath: string) =>
    Effect.all([normalizeEffect(method, fromPath), normalizeEffect(method, toPath)] as const)

  const run = <A>(method: string, file: string, fn: (file: string) => Promise<A>) =>
    Effect.gen(function* () {
      const normalized = yield* normalizeEffect(method, file)
      return yield* Effect.tryPromise({
        try: () => fn(normalized),
        catch: (cause) => failure(method, file, cause),
      })
    })

  fs.mkdirSync(root, { recursive: true })
  for (const [file, content] of Object.entries(options.files ?? {})) {
    const normalized = normalize("seed", file)
    if (typeof normalized === "string") {
      fs.mkdirSync(path.dirname(normalized), { recursive: true })
      fs.writeFileSync(normalized, content, { encoding: "utf8" })
    }
  }

  const base = FileSystem.make({
    access: (file) => run("access", file, async (item) => void (await fs.stat(item))),
    chmod: (file, mode) => run("chmod", file, (item) => fs.chmod(item, mode)),
    chown: () => Effect.fail(unsupported("chown")),
    copy: (fromPath, toPath) =>
      Effect.gen(function* () {
        const [from, to] = yield* normalizePair("copy", fromPath, toPath)
        yield* Effect.tryPromise({
          try: () => fs.cp(from, to, { recursive: true }),
          catch: (cause) => failure("copy", fromPath, cause),
        })
      }),
    copyFile: (fromPath, toPath) =>
      Effect.gen(function* () {
        const [from, to] = yield* normalizePair("copyFile", fromPath, toPath)
        yield* Effect.tryPromise({
          try: () => fs.cp(from, to),
          catch: (cause) => failure("copyFile", fromPath, cause),
        })
      }),
    link: (existingPath, newPath) =>
      Effect.gen(function* () {
        const [existing, next] = yield* normalizePair("link", existingPath, newPath)
        yield* Effect.tryPromise({
          try: () => fs.link(existing, next),
          catch: (cause) => failure("link", existingPath, cause),
        })
      }),
    makeDirectory: (file, methodOptions) => run("makeDirectory", file, (item) => fs.mkdir(item, methodOptions)),
    makeTempDirectory: (methodOptions) =>
      Effect.gen(function* () {
        const directory = yield* normalizeEffect("makeTempDirectory", methodOptions?.directory ?? root)
        const file = path.join(directory, `${methodOptions?.prefix ?? "tmp-"}${++temp.value}`)
        yield* base.makeDirectory(file, { recursive: true })
        return file
      }),
    makeTempDirectoryScoped: (methodOptions) =>
      Effect.acquireRelease(
        base.makeTempDirectory(methodOptions),
        (file) => base.remove(file, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    makeTempFile: (methodOptions) =>
      Effect.gen(function* () {
        const directory = yield* normalizeEffect("makeTempFile", methodOptions?.directory ?? root)
        const file = path.join(directory, `${methodOptions?.prefix ?? "tmp-"}${++temp.value}${methodOptions?.suffix ?? ""}`)
        yield* base.writeFile(file, new Uint8Array())
        return file
      }),
    makeTempFileScoped: (methodOptions) =>
      Effect.acquireRelease(base.makeTempFile(methodOptions), (file) => base.remove(file, { force: true }).pipe(Effect.ignore)),
    open: (file) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeEffect("open", file)
        yield* base.access(normalized)
        let position = 0
        const readCurrent = () => fs.readFileBuffer(normalized)
        return {
          [FileSystem.FileTypeId]: FileSystem.FileTypeId,
          fd: FileSystem.FileDescriptor(0),
          stat: base.stat(normalized),
          seek: (offset, from) =>
            Effect.sync(() => {
              position = from === "start" ? Number(offset) : position + Number(offset)
            }),
          sync: Effect.void,
          read: (buffer) =>
            Effect.gen(function* () {
              const content = yield* Effect.promise(readCurrent)
              const chunk = content.slice(position, position + buffer.length)
              buffer.set(chunk)
              position += chunk.length
              return FileSystem.Size(chunk.length)
            }),
          readAlloc: (size) =>
            Effect.gen(function* () {
              const content = yield* Effect.promise(readCurrent)
              const chunk = content.slice(position, position + Number(size))
              position += chunk.length
              return chunk.length === 0 ? Option.none() : Option.some(chunk)
            }),
          truncate: (size) => base.truncate(normalized, size),
          write: () => Effect.fail(unsupported("file.write")),
          writeAll: () => Effect.fail(unsupported("file.writeAll")),
        }
      }),
    readDirectory: (file, methodOptions) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeEffect("readDirectory", file)
        if (!methodOptions?.recursive) return yield* run("readDirectory", normalized, (item) => fs.readdir(item))
        return fs
          .getAllPaths()
          .filter((item) => item !== normalized && AppFileSystem.contains(normalized, item))
          .map((item) => path.relative(normalized, item))
          .sort((a, b) => a.localeCompare(b))
      }),
    readFile: (file) => run("readFile", file, (item) => fs.readFileBuffer(item)),
    readLink: (file) => run("readLink", file, (item) => fs.readlink(item)),
    realPath: (file) => run("realPath", file, (item) => fs.realpath(item)),
    remove: (file, methodOptions) => run("remove", file, (item) => fs.rm(item, methodOptions)),
    rename: (oldPath, newPath) =>
      Effect.gen(function* () {
        const [oldNormalized, newNormalized] = yield* normalizePair("rename", oldPath, newPath)
        yield* Effect.tryPromise({
          try: () => fs.mv(oldNormalized, newNormalized),
          catch: (cause) => failure("rename", oldPath, cause),
        })
      }),
    stat: (file) =>
      run("stat", file, async (item) => {
        const info = await fs.stat(item)
        return {
          type: info.isDirectory ? "Directory" : info.isSymbolicLink ? "SymbolicLink" : "File",
          mtime: Option.some(info.mtime),
          atime: Option.some(info.mtime),
          birthtime: Option.some(info.mtime),
          dev: 0,
          ino: Option.none(),
          mode: info.mode,
          nlink: Option.none(),
          uid: Option.none(),
          gid: Option.none(),
          rdev: Option.none(),
          size: FileSystem.Size(info.size),
          blksize: Option.none(),
          blocks: Option.none(),
        } satisfies FileSystem.File.Info
      }),
    symlink: (target, linkPath) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeEffect("symlink", linkPath)
        yield* Effect.tryPromise({
          try: () => fs.symlink(target, normalized),
          catch: (cause) => failure("symlink", linkPath, cause),
        })
      }),
    truncate: (file, size = 0) =>
      run("truncate", file, async (item) => {
        const next = new Uint8Array(Number(size))
        next.set((await fs.readFileBuffer(item)).slice(0, next.length))
        await fs.writeFile(item, next)
      }),
    utimes: (file, atime, mtime) =>
      run("utimes", file, (item) =>
        fs.utimes(item, typeof atime === "number" ? new Date(atime) : atime, typeof mtime === "number" ? new Date(mtime) : mtime),
      ),
    watch: () => Stream.fail(unsupported("watch")),
    writeFile: (file, content, methodOptions) =>
      run("writeFile", file, async (item) => {
        await fs.writeFile(item, content)
        if (methodOptions?.mode) await fs.chmod(item, methodOptions.mode)
      }),
  })

  const glob = (pattern: string, globOptions?: Glob.Options) =>
    Effect.gen(function* () {
      const cwd = yield* normalizeEffect("glob", globOptions?.cwd ?? root)
      const matches = yield* Effect.forEach(
        fs
          .getAllPaths()
          .filter((item) => item !== cwd && AppFileSystem.contains(cwd, item))
          .sort((a, b) => a.localeCompare(b)),
        (file) =>
          base.stat(file).pipe(
            Effect.map((info) => ({ file, info, relative: path.relative(cwd, file) })),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
      )
      return matches
        .filter((item) => item && (globOptions?.include === "all" || item.info.type === "File") && Glob.match(pattern, item.relative))
        .map((item) => (globOptions?.absolute ? item!.file : item!.relative))
    })

  const service = AppFileSystem.Service.of({
    ...base,
    isDir: (file) => base.stat(file).pipe(Effect.map((info) => info.type === "Directory"), Effect.catch(() => Effect.succeed(false))),
    isFile: (file) => base.stat(file).pipe(Effect.map((info) => info.type === "File"), Effect.catch(() => Effect.succeed(false))),
    existsSafe: (file) => base.exists(file).pipe(Effect.orElseSucceed(() => false)),
    readFileStringSafe: (file) => base.readFileString(file).pipe(Effect.catch(() => Effect.succeed(undefined))),
    readJson: (file) => base.readFileString(file).pipe(Effect.map((content) => JSON.parse(content))),
    writeJson: (file, data, mode) =>
      base.writeFileString(file, JSON.stringify(data, null, 2)).pipe(Effect.andThen(mode ? base.chmod(file, mode) : Effect.void)),
    ensureDir: (file) => base.makeDirectory(file, { recursive: true }),
    writeWithDirs: (file, content, mode) =>
      Effect.gen(function* () {
        yield* base.makeDirectory(path.dirname(file), { recursive: true })
        if (typeof content === "string") yield* base.writeFileString(file, content, mode ? { mode } : undefined)
        else yield* base.writeFile(file, content, mode ? { mode } : undefined)
      }),
    readDirectoryEntries: (file) =>
      run("readDirectoryEntries", file, async (item) =>
        (await fs.readdirWithFileTypes(item))
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory ? "directory" : entry.isSymbolicLink ? "symlink" : entry.isFile ? "file" : "other",
          }) satisfies AppFileSystem.DirEntry)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    findUp: (target, start, stop) => service.up({ targets: [target], start, stop }),
    up: (methodOptions) =>
      Effect.gen(function* () {
        const result: string[] = []
        let current = normalizeSearchStart(methodOptions.start)
        if (!current) return result
        const normalizedStop = methodOptions.stop ? normalizeSearchStart(methodOptions.stop) : undefined
        while (true) {
          for (const target of methodOptions.targets) {
            const file = path.join(current, target)
            if (yield* base.exists(file)) result.push(file)
          }
          if (normalizedStop === current) break
          const parent = path.dirname(current)
          if (parent === current || !AppFileSystem.contains(root, parent)) break
          current = parent
        }
        return result
      }),
    globUp: (pattern, start, stop) =>
      Effect.gen(function* () {
        const result: string[] = []
        let current = normalizeSearchStart(start)
        if (!current) return result
        const normalizedStop = stop ? normalizeSearchStart(stop) : undefined
        while (true) {
          result.push(...(yield* glob(pattern, { cwd: current, absolute: true, include: "file", dot: true })))
          if (normalizedStop === current) break
          const parent = path.dirname(current)
          if (parent === current || !AppFileSystem.contains(root, parent)) break
          current = parent
        }
        return result
      }),
    glob,
    globMatch: Glob.match,
  })

  return service
}

export const layer = (options: Options) => Layer.succeed(AppFileSystem.Service)(make(options))

export * as SimulationFileSystem from "./filesystem"

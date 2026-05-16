import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { parsePatch } from "diff"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { useBindings } from "../keymap"

type DiffFile = {
  readonly file: string
  readonly patch: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

const stripPrefix = (file: string | undefined) => {
  if (!file || file === "/dev/null") return undefined
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

const splitRawDiff = (text: string) => {
  const starts = [...text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  if (starts.length === 0) return text.trim() ? [text] : []
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length))
}

const parseRawDiff = (text: string): DiffFile[] => {
  const chunks = splitRawDiff(text)
  return chunks.flatMap((chunk) => {
    const parsed = parsePatch(chunk)[0]
    const file = stripPrefix(parsed?.newFileName) ?? stripPrefix(parsed?.oldFileName)
    if (!parsed || !file) return []

    const counts = parsed.hunks.flatMap((hunk) => hunk.lines).reduce(
      (acc, line) => ({
        additions: acc.additions + (line.startsWith("+") ? 1 : 0),
        deletions: acc.deletions + (line.startsWith("-") ? 1 : 0),
      }),
      { additions: 0, deletions: 0 },
    )

    return [
      {
        file,
        patch: chunk,
        additions: counts.additions,
        deletions: counts.deletions,
        status: parsed.oldFileName === "/dev/null" ? "added" : parsed.newFileName === "/dev/null" ? "deleted" : "modified",
      } satisfies DiffFile,
    ]
  })
}

const lineKind = (line: string) => {
  if (line.startsWith("+")) return "added"
  if (line.startsWith("-")) return "deleted"
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "meta"
  return "context"
}

export function DiffViewer(props: { onClose: () => void }) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [selected, setSelected] = createSignal(0)
  const [raw] = createResource(async () => {
    const result = await sdk.client.vcs.diff2.raw(undefined, { throwOnError: true })
    return result.data ?? ""
  })
  const files = createMemo(() => parseRawDiff(raw() ?? ""))
  const current = createMemo(() => files()[selected()])
  const lines = createMemo(() => current()?.patch.trimEnd().split(/\r?\n/) ?? [])

  const move = (delta: number) => {
    const total = files().length
    if (total === 0) return
    setSelected((selected() + delta + total) % total)
  }

  createEffect(() => {
    if (selected() >= files().length) setSelected(Math.max(0, files().length - 1))
  })

  useBindings(() => ({
    priority: 2000,
    bindings: [
      {
        key: "up",
        desc: "Previous file",
        group: "Diff",
        cmd: () => move(-1),
      },
      {
        key: "k",
        desc: "Previous file",
        group: "Diff",
        cmd: () => move(-1),
      },
      {
        key: "down",
        desc: "Next file",
        group: "Diff",
        cmd: () => move(1),
      },
      {
        key: "j",
        desc: "Next file",
        group: "Diff",
        cmd: () => move(1),
      },
      {
        key: "escape",
        desc: "Close diff viewer",
        group: "Diff",
        cmd: props.onClose,
      },
      {
        key: "q",
        desc: "Close diff viewer",
        group: "Diff",
        cmd: props.onClose,
      },
    ],
  }))

  return (
    <box
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>Diff</text>
          <text fg={theme.textMuted}>working tree</text>
        </box>
        <text fg={theme.textMuted}>j/k select · q/esc close</text>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} gap={2}>
        <box
          width={32}
          flexShrink={0}
          backgroundColor={theme.backgroundPanel}
          border={["left", "right"]}
          borderColor={theme.border}
          customBorderChars={SplitBorder.customBorderChars}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          gap={1}
        >
          <text fg={theme.textMuted}>Files</text>
          <Switch>
            <Match when={raw.loading}>
              <text fg={theme.textMuted}>Loading diff...</text>
            </Match>
            <Match when={raw.error}>
              <text fg={theme.error}>Failed to load diff</text>
            </Match>
            <Match when={files().length === 0}>
              <text fg={theme.text}>No changes</text>
            </Match>
            <Match when={files().length > 0}>
              <For each={files()}>
                {(file, index) => (
                  <box flexDirection="row" gap={1} backgroundColor={index() === selected() ? theme.backgroundElement : undefined}>
                    <text fg={index() === selected() ? theme.accent : theme.text}>{index() === selected() ? "›" : " "}</text>
                    <text fg={theme.text} wrapMode="none">
                      {file.file}
                    </text>
                    <text fg={theme.diffAdded}>+{file.additions}</text>
                    <text fg={theme.diffRemoved}>-{file.deletions}</text>
                  </box>
                )}
              </For>
            </Match>
          </Switch>
        </box>

        <box
          flexGrow={1}
          minWidth={0}
          backgroundColor={theme.backgroundPanel}
          border={["left", "right"]}
          borderColor={theme.borderActive}
          customBorderChars={SplitBorder.customBorderChars}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          gap={1}
        >
          <Show
            when={current()}
            fallback={<text fg={theme.textMuted}>{raw.loading ? "Loading diff..." : raw.error ? "Failed to load diff" : "No diff to show"}</text>}
          >
            {(file) => (
              <>
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text fg={theme.text}>{file().file}</text>
                  <text fg={theme.textMuted}>{file().status}</text>
                  <text fg={theme.diffAdded}>+{file().additions}</text>
                  <text fg={theme.diffRemoved}>-{file().deletions}</text>
                </box>
                <scrollbox flexGrow={1} minHeight={0}>
                  <For each={lines()}>
                    {(line) => {
                      const kind = lineKind(line)
                      return (
                        <text
                          fg={
                            kind === "added"
                              ? theme.diffAdded
                              : kind === "deleted"
                                ? theme.diffRemoved
                                : kind === "hunk"
                                  ? theme.accent
                                  : kind === "meta"
                                    ? theme.textMuted
                                    : theme.text
                          }
                          wrapMode="none"
                        >
                          {line || " "}
                        </text>
                      )
                    }}
                  </For>
                </scrollbox>
              </>
            )}
          </Show>
        </box>
      </box>
    </box>
  )
}

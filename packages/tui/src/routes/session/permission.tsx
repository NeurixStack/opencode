import { createStore } from "solid-js/store"
import { dirname } from "node:path"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Portal, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme, selectedForeground } from "../../context/theme"
import type { PermissionV2Request } from "@opencode-ai/client"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useData } from "../../context/data"
import { filetype } from "../../util/filetype"
import { Locale } from "../../util/locale"
import { webSearchProviderLabel } from "../../util/tool-display"
import { getScrollAcceleration } from "../../util/scroll"
import { useConfig } from "../../config"
import { OPENCODE_BASE_MODE, useBindings, useCommandShortcut } from "../../keymap"
import { usePathFormatter } from "../../context/path-format"

type PermissionStage = "permission" | "always" | "reject"

function EditBody(props: { request: PermissionV2Request; patch?: string }) {
  const themeState = useTheme()
  const theme = themeState.theme
  const syntax = themeState.syntax
  const config = useConfig().data
  const dimensions = useTerminalDimensions()

  const filepath = createMemo(() => {
    return props.request.resources[0] ?? ""
  })
  const diff = createMemo(() => {
    const value = props.request.metadata?.diff
    return typeof value === "string" ? value : ""
  })

  const view = createMemo(() => {
    const diffView = config.diffs?.view
    if (diffView === "unified") return "unified"
    if (diffView === "split") return "split"
    return dimensions().width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(filepath()))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  return (
    <box flexDirection="column" gap={1}>
      <Show when={diff()}>
        <scrollbox
          height="100%"
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <diff
            diff={diff()}
            view={view()}
            filetype={ft()}
            syntaxStyle={syntax()}
            showLineNumbers={true}
            width="100%"
            wrapMode="word"
            fg={theme.text}
            addedBg={theme.diffAddedBg}
            removedBg={theme.diffRemovedBg}
            contextBg={theme.diffContextBg}
            addedSignColor={theme.diffHighlightAdded}
            removedSignColor={theme.diffHighlightRemoved}
            lineNumberFg={theme.diffLineNumber}
            lineNumberBg={theme.diffContextBg}
            addedLineNumberBg={theme.diffAddedLineNumberBg}
            removedLineNumberBg={theme.diffRemovedLineNumberBg}
          />
        </scrollbox>
      </Show>
      <Show when={!diff()}>
        <Show
          when={props.patch}
          fallback={
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>No diff provided</text>
            </box>
          }
        >
          {(patch) => (
            <scrollbox
              height="100%"
              scrollAcceleration={scrollAcceleration()}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: theme.background,
                  foregroundColor: theme.borderActive,
                },
              }}
            >
              <code
                filetype="diff"
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={syntax()}
                content={patch()}
                fg={theme.textMuted}
              />
            </scrollbox>
          )}
        </Show>
      </Show>
    </box>
  )
}

function TextBody(props: { title: string; description?: string; icon?: string }) {
  const { theme } = useTheme()
  return (
    <>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <Show when={props.icon}>
          <text fg={theme.textMuted} flexShrink={0}>
            {props.icon}
          </text>
        </Show>
        <text fg={theme.textMuted}>{props.title}</text>
      </box>
      <Show when={props.description}>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.description}</text>
        </box>
      </Show>
    </>
  )
}

function preview(input?: string) {
  const text = input?.trim()
  if (!text) return ""
  const lines = text.split("\n")
  const first = lines[0]!.length > 60 ? `${lines[0]!.slice(0, 57)}...` : lines[0]!
  return lines.length === 1 ? first : `${first} ... (+${lines.length - 1} lines)`
}

function text(input: unknown) {
  return typeof input === "string" ? input : undefined
}

function ExternalBody(props: {
  file?: string
  dir?: string
  preview?: string
  content?: string
  syntaxType?: string
  expanded?: boolean
  note?: string
}) {
  const themeState = useTheme()
  const theme = themeState.theme
  const dimensions = useTerminalDimensions()
  return (
    <box flexDirection="column" gap={1} paddingLeft={1} flexGrow={props.expanded ? 1 : 0}>
      <Show when={props.file}>
        <text fg={theme.textMuted}>{"File: " + props.file}</text>
      </Show>
      <Show when={props.dir}>
        <text fg={theme.textMuted}>{"Directory: " + props.dir}</text>
      </Show>
      <Show when={props.content && (props.expanded || dimensions().width >= 50)}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.textMuted}>Preview</text>
          <Show
            when={props.expanded}
            fallback={
              <box paddingLeft={1}>
                <text fg={theme.text}>{props.preview}</text>
              </box>
            }
          >
            <scrollbox height="100%">
              <code
                filetype={props.syntaxType ?? "text"}
                drawUnstyledText={false}
                streaming={true}
                syntaxStyle={themeState.syntax()}
                content={props.content}
                fg={theme.text}
              />
            </scrollbox>
          </Show>
        </box>
      </Show>
      <Show when={props.note}>
        <text fg={theme.textMuted}>{props.note}</text>
      </Show>
    </box>
  )
}

export function PermissionPrompt(props: { request: PermissionV2Request; directory?: string }) {
  const sdk = useSDK()
  const data = useData()
  const [store, setStore] = createStore({
    stage: "permission" as PermissionStage,
    submitting: false,
  })
  const pathFormatter = usePathFormatter()
  const session = createMemo(() => data.session.get(props.request.sessionID))

  const part = createMemo(() => {
    const tool = props.request.source
    if (!tool) return
    const message = data.session.message.get(props.request.sessionID, tool.messageID)
    if (message?.type !== "assistant") return
    return message.content.find((part) => part.type === "tool" && part.id === tool.callID)
  })

  const input = createMemo(() => {
    const current = part()
    if (current?.type === "tool" && current.state.status !== "streaming") return current.state.input
    return {}
  })
  const toolName = createMemo(() => {
    const current = part()
    return current?.type === "tool" ? current.name : ""
  })

  const { theme } = useTheme()
  const respond = (reply: "once" | "always" | "reject", message?: string) => {
    if (store.submitting) return
    setStore("submitting", true)
    void sdk.api.permission
      .reply({
        sessionID: props.request.sessionID,
        reply,
        requestID: props.request.id,
        message: message || undefined,
      })
      .catch(() => setStore("submitting", false))
  }

  return (
    <Switch>
      <Match when={store.stage === "always"}>
        <Prompt
          title="Always allow"
          body={
            <Switch>
              <Match when={props.request.save?.length === 1 && props.request.save[0] === "*"}>
                <TextBody title={"This will allow all " + props.request.action + " requests for this project."} />
              </Match>
              <Match when={true}>
                <box paddingLeft={1} gap={1}>
                  <text fg={theme.textMuted}>This will save the following scopes for this project</text>
                  <box>
                    <For each={props.request.save ?? []}>
                      {(pattern) => (
                        <text fg={theme.text}>
                          {"- "}
                          {pattern}
                        </text>
                      )}
                    </For>
                  </box>
                </box>
              </Match>
            </Switch>
          }
          options={{ confirm: "Confirm", cancel: "Cancel" }}
          escapeKey="cancel"
          onSelect={(option) => {
            setStore("stage", "permission")
            if (option === "cancel") return
            respond("always")
          }}
        />
      </Match>
      <Match when={store.stage === "reject"}>
        <RejectPrompt
          onConfirm={(message) => {
            respond("reject", message)
          }}
          onCancel={() => {
            setStore("stage", "permission")
          }}
        />
      </Match>
      <Match when={store.stage === "permission"}>
        {(() => {
          const info = () => {
            const permission = props.request.action
            const data = input()

            if (permission === "edit") {
              const filepath = props.request.resources[0] ?? ""
              const patch = typeof data.patchText === "string" ? data.patchText : undefined
              return {
                icon: "→",
                title: `Edit ${pathFormatter.format(filepath)}`,
                body: <EditBody request={props.request} patch={patch} />,
              }
            }

            if (permission === "read") {
              const raw = data.path
              const filePath = typeof raw === "string" ? raw : ""
              return {
                icon: "→",
                title: `Read ${pathFormatter.format(filePath)}`,
                body: (
                  <Show when={filePath}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"Path: " + pathFormatter.format(filePath)}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "glob") {
              const pattern = typeof data.pattern === "string" ? data.pattern : ""
              return {
                icon: "✱",
                title: `Glob "${pattern}"`,
                body: (
                  <Show when={pattern}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"Pattern: " + pattern}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "grep") {
              const pattern = typeof data.pattern === "string" ? data.pattern : ""
              return {
                icon: "✱",
                title: `Grep "${pattern}"`,
                body: (
                  <Show when={pattern}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"Pattern: " + pattern}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "list") {
              const raw = data.path
              const dir = typeof raw === "string" ? raw : ""
              return {
                icon: "→",
                title: `List ${pathFormatter.format(dir)}`,
                body: (
                  <Show when={dir}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"Path: " + pathFormatter.format(dir)}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "shell") {
              const command = typeof data.command === "string" ? data.command : ""
              return {
                icon: "#",
                title: "Run shell command",
                body: (
                  <Show when={command}>
                    <box paddingLeft={1}>
                      <text fg={theme.text}>{"$ " + command}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "subagent" || permission === "task") {
              const agent =
                typeof data.agent === "string"
                  ? data.agent
                  : typeof data.subagent_type === "string"
                    ? data.subagent_type
                    : "Unknown"
              const desc = typeof data.description === "string" ? data.description : ""
              return {
                icon: "#",
                title: `${Locale.titlecase(agent)} Subagent`,
                body: (
                  <Show when={desc}>
                    <box paddingLeft={1}>
                      <text fg={theme.text}>{"◉ " + desc}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "webfetch") {
              const url = typeof data.url === "string" ? data.url : ""
              return {
                icon: "%",
                title: `WebFetch ${url}`,
                body: (
                  <Show when={url}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"URL: " + url}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "websearch") {
              const query = typeof data.query === "string" ? data.query : ""
              return {
                icon: "◈",
                title: `${webSearchProviderLabel(data.provider)} "${query}"`,
                body: (
                  <Show when={query}>
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>{"Query: " + query}</text>
                    </box>
                  </Show>
                ),
              }
            }

            if (permission === "external_directory") {
              const meta = props.request.metadata ?? {}
              const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined
              const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined
              const pattern = props.request.resources[0]
              const derived =
                typeof pattern === "string" ? (pattern.includes("*") ? dirname(pattern) : pattern) : undefined
              const rawFile = text(data.path) ?? filepath
              const file = pathFormatter.format(rawFile)
              const dir = pathFormatter.format(parent ?? derived)
              const saved = props.request.save?.[0]
              const remembered = pathFormatter.format(saved && saved !== "*" ? dirname(saved) : (parent ?? derived))
              const note = remembered ? `Allow always remembers access to ${remembered} for this project.` : undefined
              const tool = toolName()

              if (tool === "write") {
                const content = text(data.content)
                return {
                  icon: "→",
                  title: "Write file outside workspace",
                  body: (expanded: boolean) => (
                    <ExternalBody
                      file={file}
                      dir={dir}
                      preview={preview(content)}
                      content={content}
                      syntaxType={filetype(file)}
                      expanded={expanded}
                      note={note}
                    />
                  ),
                }
              }
              if (tool === "edit") {
                const oldString = text(data.oldString)
                const newString = text(data.newString)
                const content =
                  oldString === undefined ? newString : ["Replace", oldString, "", "With", newString ?? ""].join("\n")
                return {
                  icon: "→",
                  title: "Edit file outside workspace",
                  body: (expanded: boolean) => (
                    <ExternalBody
                      file={file}
                      dir={dir}
                      preview={preview(newString)}
                      content={content}
                      syntaxType={filetype(file)}
                      expanded={expanded}
                      note={note}
                    />
                  ),
                }
              }
              if (tool === "patch") {
                const content = text(data.patchText)
                return {
                  icon: "→",
                  title: "Apply patch outside workspace",
                  body: (expanded: boolean) => (
                    <ExternalBody
                      dir={dir}
                      preview={preview(content)}
                      content={content}
                      syntaxType="diff"
                      expanded={expanded}
                      note={note}
                    />
                  ),
                }
              }
              if (tool === "read")
                return {
                  icon: "→",
                  title: "Read outside workspace",
                  body: <ExternalBody file={file} dir={dir} note={note} />,
                }
              if (tool === "shell")
                return {
                  icon: "←",
                  title: "Access external working directory",
                  body: <ExternalBody dir={dir} note={note} />,
                }
              return {
                icon: "←",
                title: `Access external directory ${dir}`,
                body: <ExternalBody file={file} dir={dir} note={note} />,
              }
            }

            if (permission === "doom_loop") {
              return {
                icon: "⟳",
                title: "Continue after repeated failures",
                body: (
                  <box paddingLeft={1}>
                    <text fg={theme.textMuted}>This keeps the session running despite repeated failures.</text>
                  </box>
                ),
              }
            }

            return {
              icon: "⚙",
              title: `Call tool ${permission}`,
              body: (
                <box paddingLeft={1}>
                  <text fg={theme.textMuted}>{"Tool: " + permission}</text>
                </box>
              ),
            }
          }

          const current = info()

          const header = () => (
            <box flexDirection="column" gap={0}>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={theme.warning}>{"△"}</text>
                <text fg={theme.text}>Permission required</text>
              </box>
              <Show when={current.title}>
                <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {current.icon}
                  </text>
                  <text fg={theme.text}>{current.title}</text>
                </box>
              </Show>
            </box>
          )

          const body = (
            <Prompt
              title="Permission required"
              header={header()}
              body={current.body}
              options={
                props.request.save?.length
                  ? { once: "Allow once", always: "Allow always", reject: "Reject" }
                  : { once: "Allow once", reject: "Reject" }
              }
              escapeKey="reject"
              fullscreen={
                props.request.action === "edit" ||
                props.request.action === "shell" ||
                (props.request.action === "external_directory" && ["write", "edit", "patch"].includes(toolName()))
              }
              onSelect={(option) => {
                if (option === "always") {
                  setStore("stage", "always")
                  return
                }
                if (option === "reject") {
                  if (session()?.parentID) {
                    setStore("stage", "reject")
                    return
                  }
                  respond("reject")
                  return
                }
                respond("once")
              }}
            />
          )

          return body
        })()}
      </Match>
    </Switch>
  )
}

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const { theme } = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "app.exit",
        title: "Cancel permission rejection",
        category: "Permission",
        run() {
          props.onCancel()
        },
      },
    ],
    bindings: [
      { key: "escape", desc: "Cancel permission rejection", group: "Permission", cmd: () => props.onCancel() },
      ...config.keybinds.get("app.exit"),
      {
        key: "return",
        desc: "Confirm permission rejection",
        group: "Permission",
        cmd: () => props.onConfirm(input.plainText),
      },
    ],
  }))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.error}>{"△"}</text>
          <text fg={theme.text}>Reject permission</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>Tell OpenCode what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(val: TextareaRenderable) => {
            input = val
            val.traits = { status: "REJECT" }
          }}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  header?: JSX.Element
  body: JSX.Element | ((expanded: boolean) => JSX.Element)
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const { theme } = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
    expanded: false,
  })
  const narrow = createMemo(() => dimensions().width < 80)
  const compact = createMemo(() => dimensions().width < 50)
  const fullscreenHint = useCommandShortcut("permission.prompt.fullscreen")
  const escapeHint = createMemo(() =>
    props.escapeKey ? String(props.options[props.escapeKey]).toLocaleLowerCase() : undefined,
  )
  const body = () => (typeof props.body === "function" ? props.body(store.expanded) : props.body)
  const shift = (direction: -1 | 1) => {
    const idx = keys.indexOf(store.selected)
    setStore("selected", keys[(idx + direction + keys.length) % keys.length])
  }

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    commands: [
      {
        name: "app.exit",
        title: "Reject permission",
        category: "Permission",
        run() {
          if (!props.escapeKey) return
          props.onSelect(props.escapeKey)
        },
      },
      {
        name: "permission.prompt.fullscreen",
        title: "Toggle permission fullscreen",
        category: "Permission",
        run() {
          if (!props.fullscreen) return
          setStore("expanded", (v) => !v)
        },
      },
    ],
    bindings: [
      {
        key: "left",
        desc: "Previous permission option",
        group: "Permission",
        cmd: () => shift(-1),
      },
      {
        key: "h",
        desc: "Previous permission option",
        group: "Permission",
        cmd: () => shift(-1),
      },
      {
        key: "right",
        desc: "Next permission option",
        group: "Permission",
        cmd: () => shift(1),
      },
      {
        key: "l",
        desc: "Next permission option",
        group: "Permission",
        cmd: () => shift(1),
      },
      ...(!props.fullscreen
        ? [
            { key: "up", desc: "Previous permission option", group: "Permission", cmd: () => shift(-1) },
            { key: "k", desc: "Previous permission option", group: "Permission", cmd: () => shift(-1) },
            { key: "down", desc: "Next permission option", group: "Permission", cmd: () => shift(1) },
            { key: "j", desc: "Next permission option", group: "Permission", cmd: () => shift(1) },
          ]
        : []),
      ...keys.slice(0, 9).map((option, index) => ({
        key: String(index + 1),
        desc: `Select ${props.options[option]}`,
        group: "Permission",
        cmd: () => props.onSelect(option),
      })),
      {
        key: "return",
        desc: "Select permission option",
        group: "Permission",
        cmd: () => props.onSelect(store.selected),
      },
      ...(props.escapeKey
        ? [
            {
              key: "escape",
              desc: "Reject permission",
              group: "Permission",
              cmd: () => props.onSelect(props.escapeKey!),
            },
          ]
        : []),
      ...(props.escapeKey ? config.keybinds.get("app.exit") : []),
      ...(props.fullscreen ? config.keybinds.get("permission.prompt.fullscreen") : []),
    ],
  }))

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))
  useRenderer()

  const content = () => (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
      {...(store.expanded
        ? { top: dimensions().height * -1 + 1, bottom: 1, left: 2, right: 2, position: "absolute" }
        : {
            top: 0,
            maxHeight: narrow() ? Math.min(24, dimensions().height - 2) : 15,
            bottom: 0,
            left: 0,
            right: 0,
            position: "relative",
          })}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <Show
          when={props.header}
          fallback={
            <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
              <text fg={theme.warning}>{"△"}</text>
              <text fg={theme.text}>{props.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {props.header}
          </box>
        </Show>
        {body()}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={2}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection={compact() ? "column" : "row"} gap={1} flexShrink={0}>
          <For each={keys}>
            {(option, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? theme.warning : undefined}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text fg={option === store.selected ? selectedForeground(theme, theme.warning) : theme.textMuted}>
                  {`${index() + 1}. ${props.options[option]}`}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection={compact() ? "column" : "row"} gap={compact() ? 0 : 2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={theme.text}>
              {fullscreenHint()} <span style={{ fg: theme.textMuted }}>{hint()}</span>
            </text>
          </Show>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
          <Show when={props.escapeKey}>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>{escapeHint()}</span>
            </text>
          </Show>
        </box>
      </box>
    </box>
  )

  return (
    <Show when={!store.expanded} fallback={<Portal>{content()}</Portal>}>
      {content()}
    </Show>
  )
}

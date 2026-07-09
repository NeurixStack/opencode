import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { For, Show, type JSXElement } from "solid-js"
import { createStore } from "solid-js/store"

export type ToolsMenuTab = "mcp" | "lsp" | "plugins"
export type ToolsMenuStatus = "connected" | "failed" | "error" | "needs_auth" | "needs_client_registration" | "disabled"

export type ToolsMenuProps = {
  defaultTab?: ToolsMenuTab
  labels: {
    menu: string
    mcp: string
    lsp: string
    plugins: string
    mcpDescription: string
    lspDescription: string
    pluginsDescription: string
    disabled: string
    failed: string
    reauthenticate: string
  }
  empty: {
    mcp: JSXElement
    lsp: JSXElement
    plugins: JSXElement
  }
  mcp: Array<{
    name: string
    status?: ToolsMenuStatus
    error?: string
    pending?: boolean
    onToggle?: () => void
  }>
  lsp: Array<{
    name: string
    status: "connected" | "error"
  }>
  plugins: string[]
}

export function ToolsMenuIcon(props: { warning?: boolean }) {
  return (
    <div class="relative size-4 text-v2-icon-icon-muted">
      <Icon name={props.warning ? "tools-warning" : "tools"} />
      <Show when={props.warning}>
        <div class="absolute right-0 top-0 size-[5px] rounded-full bg-icon-warning-base" />
      </Show>
    </div>
  )
}

export function ToolsMenu(props: ToolsMenuProps) {
  const [state, setState] = createStore({ tab: props.defaultTab ?? ("mcp" as ToolsMenuTab) })

  return (
    <div class="w-[360px] max-w-[calc(100vw-40px)] rounded-xl bg-v2-background-bg-base p-4 shadow-[var(--v2-elevation-floating)]">
      <SegmentedControlV2
        value={state.tab}
        onChange={(value) => value && setState("tab", value as ToolsMenuTab)}
        class="segmented-control-v2--full-width"
        aria-label={props.labels.menu}
      >
        <SegmentedControlItemV2 value="mcp">{props.labels.mcp}</SegmentedControlItemV2>
        <SegmentedControlItemV2 value="lsp">{props.labels.lsp}</SegmentedControlItemV2>
        <SegmentedControlItemV2 value="plugins">{props.labels.plugins}</SegmentedControlItemV2>
      </SegmentedControlV2>

      <Show when={state.tab === "mcp"}>
        <Show
          when={props.mcp.length > 0}
          fallback={<ToolsEmpty title={props.empty.mcp} description={props.labels.mcpDescription} />}
        >
          <ToolsList description={props.labels.mcpDescription}>
            <For each={props.mcp}>
              {(item) => (
                <div class="flex h-8 items-center gap-2 px-2">
                  <StatusDot status={item.status} />
                  <span class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-4 tracking-[-0.04px] text-v2-text-text-base">
                    {item.name}
                  </span>
                  <Show
                    when={item.status === "needs_auth"}
                    fallback={
                      <>
                        <Show when={item.status === "needs_client_registration"}>
                          <span
                            class="max-w-40 truncate text-[11px] font-[440] leading-4 tracking-[0.05px] text-v2-text-text-faint"
                            title={item.error}
                          >
                            {item.error ?? props.labels.failed}
                          </span>
                        </Show>
                        <Show when={item.status !== "needs_client_registration"}>
                          <Show when={item.status === "disabled" || item.status === "failed"}>
                            <span class="text-[11px] font-[440] capitalize leading-4 tracking-[0.05px] text-v2-text-text-faint">
                              {item.status === "disabled" ? props.labels.disabled : props.labels.failed}
                            </span>
                          </Show>
                          <Switch
                            checked={item.status === "connected"}
                            disabled={item.pending || !item.status}
                            hideLabel
                            onChange={item.onToggle}
                          >
                            {item.name}
                          </Switch>
                        </Show>
                      </>
                    }
                  >
                    <ButtonV2 size="small" variant="outline" disabled={item.pending} onClick={item.onToggle}>
                      {props.labels.reauthenticate}
                    </ButtonV2>
                  </Show>
                </div>
              )}
            </For>
          </ToolsList>
        </Show>
      </Show>

      <Show when={state.tab === "lsp"}>
        <Show
          when={props.lsp.length > 0}
          fallback={<ToolsEmpty title={props.empty.lsp} description={props.labels.lspDescription} />}
        >
          <ToolsList description={props.labels.lspDescription}>
            <For each={props.lsp}>
              {(item) => (
                <div class="flex h-8 items-center gap-2 px-2">
                  <StatusDot status={item.status} />
                  <span class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-4 tracking-[-0.04px] text-v2-text-text-base">
                    {item.name}
                  </span>
                </div>
              )}
            </For>
          </ToolsList>
        </Show>
      </Show>

      <Show when={state.tab === "plugins"}>
        <Show
          when={props.plugins.length > 0}
          fallback={<ToolsEmpty title={props.empty.plugins} description={props.labels.pluginsDescription} />}
        >
          <ToolsList description={props.labels.pluginsDescription}>
            <For each={props.plugins}>
              {(plugin) => (
                <div class="flex h-8 items-center gap-2 px-2">
                  <StatusDot status="connected" />
                  <span class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-4 tracking-[-0.04px] text-v2-text-text-base">
                    {plugin}
                  </span>
                </div>
              )}
            </For>
          </ToolsList>
        </Show>
      </Show>
    </div>
  )
}

function ToolsList(props: { description: string; children: JSXElement }) {
  return (
    <div class="mt-2 flex flex-col">
      <div class="flex h-8 items-center px-2 text-[11px] font-[440] leading-4 tracking-[0.05px] text-v2-text-text-faint">
        {props.description}
      </div>
      {props.children}
    </div>
  )
}

function ToolsEmpty(props: { title: JSXElement; description: string }) {
  return (
    <div class="mt-4 flex flex-col gap-2 text-center text-[13px] leading-4 tracking-[-0.04px]">
      <div class="h-4 font-[500] text-v2-text-text-muted">{props.title}</div>
      <div class="h-4 font-[440] text-v2-text-text-faint">{props.description}</div>
    </div>
  )
}

function StatusDot(props: { status?: ToolsMenuStatus }) {
  return (
    <div
      classList={{
        "size-1.5 shrink-0 rounded-full": true,
        "bg-v2-state-fg-success": props.status === "connected",
        "bg-v2-state-fg-danger": props.status === "failed" || props.status === "error",
        "bg-v2-state-fg-warning": props.status === "needs_auth" || props.status === "needs_client_registration",
        "bg-v2-border-border-base": props.status === "disabled",
      }}
    />
  )
}

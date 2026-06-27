import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import type { Session } from "@opencode-ai/sdk/v2"
import { For, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { childSessionTitle } from "./session-child-sessions"

export function SessionChildSessionPicker(props: {
  sessions: Session[]
  activeID?: string
  working: (sessionID: string) => boolean
  onSelect: (sessionID: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    active: Math.max(
      0,
      props.sessions.findIndex((session) => session.id === props.activeID),
    ),
  })
  const refs: HTMLButtonElement[] = []
  let frame: number | undefined

  const focus = (index: number) => {
    const total = props.sessions.length
    if (total === 0) return
    const next = (index + total) % total
    setStore("active", next)
    refs[next]?.focus()
    refs[next]?.scrollIntoView({ block: "nearest" })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focus(store.active + 1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      focus(store.active - 1)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focus(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focus(props.sessions.length - 1)
    }
  }

  onMount(() => {
    frame = requestAnimationFrame(() => focus(store.active))
  })
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <DockPrompt
      kind="question"
      onKeyDown={onKeyDown}
      header={
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div data-slot="question-header-title">{language.t("session.child.picker.title")}</div>
          <div class="shrink-0 text-12-regular text-text-weak">{props.sessions.length}</div>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" size="large" onClick={props.onClose} aria-keyshortcuts="Escape">
            {language.t("common.dismiss")}
          </Button>
          <div data-slot="question-footer-actions" class="text-12-regular text-text-weak">
            {language.t("session.child.picker.hint")}
          </div>
        </>
      }
    >
      <div data-slot="question-text">{language.t("session.child.picker.description")}</div>
      <div
        data-slot="question-options"
        role="listbox"
        aria-label={language.t("session.child.picker.title")}
        class="max-h-64"
      >
        <For each={props.sessions}>
          {(session, index) => {
            const running = () => props.working(session.id)
            return (
              <button
                ref={(el) => (refs[index()] = el)}
                type="button"
                role="option"
                data-slot="question-option"
                data-picked={session.id === props.activeID}
                aria-selected={session.id === props.activeID}
                onFocus={() => setStore("active", index())}
                onClick={() => props.onSelect(session.id)}
              >
                <span
                  classList={{
                    "mt-1.5 size-2 shrink-0 rounded-full": true,
                    "bg-icon-success-base": running(),
                    "bg-icon-weak-base": !running(),
                  }}
                  aria-hidden="true"
                />
                <span data-slot="question-option-main">
                  <span data-slot="option-label" class="flex items-center justify-between gap-3">
                    <span class="truncate">@{session.agent ?? language.t("session.child.picker.agentFallback")}</span>
                    <span
                      classList={{
                        "shrink-0 text-12-regular": true,
                        "text-text-base": running(),
                        "text-text-weak": !running(),
                      }}
                    >
                      {running()
                        ? language.t("session.child.picker.running")
                        : language.t("session.child.picker.complete")}
                    </span>
                  </span>
                  <span data-slot="option-description" class="line-clamp-2">
                    {childSessionTitle(session)}
                  </span>
                </span>
                <Icon name="chevron-right" size="small" class="mt-1 shrink-0 text-icon-weak" aria-hidden="true" />
              </button>
            )
          }}
        </For>
      </div>
    </DockPrompt>
  )
}

import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import type { Theme } from "../../theme"
import { formatDuration } from "../../util/format"
import { DialogAlert } from "../../ui/dialog-alert"
import type { useDialog } from "../../ui/dialog"

type RetryStatus = Extract<SessionStatus, { type: "retry" }>

export function PromptRetryStatus(props: { status: RetryStatus; theme: Theme; dialog: ReturnType<typeof useDialog> }) {
  const message = createMemo(() => {
    if (props.status.message.includes("exceeded your current quota") && props.status.message.includes("gemini"))
      return "gemini is way too hot right now"
    if (props.status.message.length > 80) return props.status.message.slice(0, 80) + "..."
    return props.status.message
  })
  const isTruncated = createMemo(() => props.status.message.length > 120)
  const [seconds, setSeconds] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => {
      if (props.status.next) setSeconds(Math.round((props.status.next - Date.now()) / 1000))
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })
  const retryText = createMemo(() => {
    const duration = formatDuration(seconds())
    return `${message()}${isTruncated() ? " (click to expand)" : ""} [retrying ${duration ? `in ${duration} ` : ""}attempt #${props.status.attempt}]`
  })

  return (
    <box
      flexShrink={1}
      onMouseUp={() => {
        if (isTruncated()) void DialogAlert.show(props.dialog, "Retry Error", props.status.message)
      }}
    >
      <text fg={props.theme.error} wrapMode="none" truncate>
        {retryText()}
      </text>
    </box>
  )
}

export function PromptInterruptHint(props: { armed: boolean; theme: Theme }) {
  return (
    <text fg={props.armed ? props.theme.primary : props.theme.text} wrapMode="none" flexShrink={0}>
      esc{" "}
      <span style={{ fg: props.armed ? props.theme.primary : props.theme.textMuted }}>
        {props.armed ? "again to interrupt" : "interrupt"}
      </span>
    </text>
  )
}

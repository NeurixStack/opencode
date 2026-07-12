import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { DialogModel } from "./dialog-model"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const { theme } = useTheme()

  dialog.setSize("xlarge")

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.id,
        title: item.id,
        description: undefined,
      }
    }),
  )

  function Preview(props: { option: DialogSelectOption<string> | undefined }) {
    const agent = createMemo(() => local.agent.list().find((item) => item.id === props.option?.value))
    const model = createMemo(() => {
      const value = agent()?.model
      if (value) return `${value.providerID}/${value.id}`
      return "Uses the current session model"
    })

    return (
      <box gap={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {agent()?.id}
        </text>
        <box>
          <text fg={theme.textMuted}>DESCRIPTION</text>
          <text fg={theme.text} wrapMode="word">
            {agent()?.description ?? "No description provided."}
          </text>
        </box>
        <box>
          <text fg={theme.textMuted}>MODEL</text>
          <text fg={agent()?.model ? theme.text : theme.textMuted}>{model()}</text>
        </box>
      </box>
    )
  }

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.id}
      options={options()}
      preview={(option) => <Preview option={option} />}
      actions={[
        {
          command: "model.list",
          title: "Choose model",
          onTrigger(option) {
            local.agent.set(option.value)
            dialog.replace(() => <DialogModel />)
          },
        },
      ]}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}

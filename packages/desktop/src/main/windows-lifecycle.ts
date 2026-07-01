export function nextWindowIDsAfterClosed(input: {
  ids: string[]
  closed: string
  remaining: number
  appQuitting: boolean
}) {
  if (input.appQuitting) return input.ids
  if (input.remaining === 0) return input.ids
  return input.ids.filter((id) => id !== input.closed)
}

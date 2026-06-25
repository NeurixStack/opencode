export function normalizeTabColor(color: string | undefined) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return
  return color.toLowerCase()
}

type ModelDisplay = {
  name: string
  provider: { id: string }
  cost?: { input: number }
}

export const isFreeModel = (model: ModelDisplay) =>
  model.provider.id === "opencode" && (!model.cost || model.cost.input === 0)

export const modelDisplayName = (model: ModelDisplay) => {
  if (!isFreeModel(model)) return model.name
  return model.name
    .replace(/\(\s*free\s*\)/gi, " ")
    .replace(/\bfree\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

import type { McpResourceContent } from "@opencode-ai/sdk/v2/client"
import type { FileAttachmentPart, Prompt } from "@/context/prompt"

type ResourceSource = Extract<NonNullable<FileAttachmentPart["source"]>, { type: "resource" }>

export const hasMcpResources = (prompt: Prompt) =>
  prompt.some((part) => part.type === "file" && part.source?.type === "resource")

export async function materializeMcpResources(
  prompt: Prompt,
  read: (source: ResourceSource) => Promise<McpResourceContent | null>,
) {
  return (
    await Promise.all(
      prompt.map(async (part): Promise<Prompt> => {
        if (part.type !== "file" || part.source?.type !== "resource") return [part]
        const resource = await read(part.source)
        if (!resource) throw new Error(`Unable to read MCP resource: ${part.source.clientName}:${part.source.uri}`)
        if (resource.contents.length === 0)
          throw new Error(`MCP resource returned no content: ${part.source.clientName}:${part.source.uri}`)
        return resource.contents.map((content, index) => {
          const mime =
            content.mimeType ?? part.mime ?? (content.type === "text" ? "text/plain" : "application/octet-stream")
          return {
            type: "file",
            path: content.uri,
            content: index === 0 ? part.content : "",
            start: index === 0 ? part.start : 0,
            end: index === 0 ? part.end : 0,
            mime,
            filename: index === 0 ? part.filename : `${part.filename ?? "resource"}-${index + 1}`,
            url: `data:${mime};base64,${content.type === "text" ? encodeText(content.text) : content.blob}`,
          }
        })
      }),
    )
  ).flat()
}

function encodeText(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
  }
  return btoa(chunks.join(""))
}

import type { CallToolResult, GetPromptResult, JSONValue, ReadResourceResult } from "@modelcontextprotocol/server";

import { specTypeSchemas } from "@modelcontextprotocol/server";

function normalize(value: unknown): JSONValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function toolResult(output: unknown): CallToolResult {
  const value = normalize(output);
  if (value === undefined) return { content: [] };

  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function resourceResult(output: unknown, uri: URL, mimeType?: string): ReadResourceResult {
  const value = normalize(output);
  if (value === undefined) return { contents: [] };

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: mimeType ?? (typeof value === "string" ? "text/plain" : "application/json"),
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  };
}

export function promptResult(output: unknown): GetPromptResult {
  if (typeof output === "string") return { messages: [{ role: "user", content: { type: "text", text: output } }] };

  const result = specTypeSchemas.GetPromptResult["~standard"].validate(output);
  if (result.issues) throw new TypeError("A prompt must return a string or a valid GetPromptResult.");

  return result.value;
}

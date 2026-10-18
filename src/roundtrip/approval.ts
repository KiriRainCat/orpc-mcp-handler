import type { Entry } from "@/handler/registry";
import type { Implementation, InputRequiredResult, ServerContext } from "@modelcontextprotocol/server";
import type { Context } from "@orpc/server";

import { acceptedContent, createRequestStateCodec, fromJsonSchema, inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

/** Signed confirmation settings for procedures that declare approval. */
export interface ApprovalOptions {
  /** Stable secret of at least 32 bytes, shared by every serving instance. */
  key: Uint8Array | string;

  /** Non-empty principal identifier, read after middleware preceding `.use(mcp)`. */
  subject: (context: Context) => string;
}

export class PendingInput extends Error {
  constructor(readonly result: InputRequiredResult) {
    super("MCP input required");
  }
}

const confirmation = fromJsonSchema<{ approved: boolean }>({
  type: "object",
  required: ["approved"],
  properties: { approved: { type: "boolean" } },
});

async function fingerprint(value: unknown) {
  const json = JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createApproval(options: ApprovalOptions, server: Implementation) {
  const codec = createRequestStateCodec<string>({ key: options.key });
  return {
    verify: (state: string, ctx: ServerContext) => codec.verify(state, ctx),
    async approve(entry: Entry, ctx: ServerContext, context: Context, input: unknown, message: true | string) {
      const subject = options.subject(context);
      if (!subject) throw new TypeError("Approval subject must not be empty.");
      const expected = await fingerprint([
        "orpc-mcp-handler/approval",
        server.name,
        server.version,
        subject,
        entry.meta.type,
        entry.path,
        entry.name,
        input,
      ]);

      const state = ctx.mcpReq.requestState<string>();
      if (state !== undefined && state !== expected) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, "确认状态与当前调用不一致");
      }

      if (state === undefined || inputResponse(ctx.mcpReq.inputResponses, "approval").kind === "missing") {
        throw new PendingInput(
          inputRequired({
            inputRequests: {
              approval: inputRequired.elicit({
                message: `${typeof message === "string" ? message : `确认执行 ${entry.meta.title ?? entry.name}？`}\n参数：${JSON.stringify(input ?? null)}`,
                requestedSchema: confirmation,
              }),
            },
            requestState: await codec.mint(expected),
          }),
        );
      }

      if (acceptedContent(ctx.mcpReq.inputResponses, "approval", confirmation)?.approved !== true) {
        throw new ORPCError("FORBIDDEN", { message: "操作已取消" });
      }
    },
  };
}

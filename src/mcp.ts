import type { ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import type { Context, Meta, MiddlewareOptions, ORPCErrorConstructorMap } from "@orpc/server";

export type MCPMeta = (ToolMeta & { type: "tool" }) | (ResourceMeta & { type: "resource" }) | (BaseMeta & { type: "prompt" });

export type MCPContext = Pick<ServerContext["mcpReq"], "inputResponses" | "requestState" | "signal">;

export type MCPScope = {
  context: MCPContext;
  approve(options: { context: Context; message: true | string }): Promise<void>;
};

export type BaseMeta = {
  /** Explicit capability name; otherwise derived from the router path and `nameSeparator`. */
  name?: string;

  /** Human-readable capability title. */
  title?: string;

  /** Description shown to MCP clients. */
  description?: string;

  /** Require confirmation before continuing; a string customizes the prompt, false disables inherited approval. */
  approval?: boolean | string;
};

export type ToolMeta = BaseMeta & {
  /** SDK behavior hints; these do not enforce authorization. */
  annotations?: ToolAnnotations;
};

export type ResourceMeta = BaseMeta & {
  /** Overrides the inferred `text/plain` or `application/json` content type. */
  mimeType?: string;
} & (
    | {
        /** Static resource URI; the procedure must omit .input(). */
        uri: string;
        uriTemplate?: never;
      }
    | {
        /** URI template using simple {name} expressions mapped to string input fields. */
        uriTemplate: string;
        uri?: never;
      }
  );

export const MCP_SCOPE = Symbol("MCP request");

function metadata(incoming: MCPMeta) {
  if (typeof incoming.approval === "string" && !incoming.approval.trim()) {
    throw new TypeError("Approval message must not be empty.");
  }

  return {
    name: "~mcp",
    init(meta: Meta): Meta {
      const current = meta["~mcp"] as MCPMeta | undefined;
      if (current && current.type !== incoming.type) {
        throw new TypeError("A procedure can expose only one MCP primitive.");
      }

      const merged = { ...current, ...incoming };
      if (incoming.type === "tool" && current?.type === "tool") {
        return { ...meta, "~mcp": { ...merged, annotations: { ...current.annotations, ...incoming.annotations } } };
      }

      return { ...meta, "~mcp": merged };
    },
  };
}

async function middleware<TOutput>({
  context,
  procedure,
  next,
}: MiddlewareOptions<Context, TOutput, ORPCErrorConstructorMap<{}>>): Promise<{
  output: TOutput;
  context: { mcp?: MCPContext };
}> {
  const scope = context[MCP_SCOPE] as MCPScope | undefined;
  if (!scope) return next();
  const meta = procedure["~orpc"].meta["~mcp"] as MCPMeta | undefined;
  if (meta?.approval) await scope.approve({ context, message: meta.approval });
  return next({ context: { mcp: scope.context } });
}

/**
 * oRPC middleware that handles declared MCP approval and injects optional context.mcp.
 *
 * Place after permission checks and before transactions or side effects. Ordinary RPC calls pass through.
 *
 * @example
 * base.input(Input).use(requirePermission).use(mcp).meta(mcp.tool({ approval: true })).handler(action)
 */
export const mcp = Object.assign(middleware, {
  /** Exposes a procedure as a tool with default JSON result conversion. */
  tool: (meta: ToolMeta = {}) => metadata({ ...meta, type: "tool" }),

  /** Exposes a procedure as a static or templated resource. */
  resource: (meta: ResourceMeta) => metadata({ ...meta, type: "resource" }),

  /** Exposes a procedure returning a string or GetPromptResult as a prompt. */
  prompt: (meta: BaseMeta = {}) => metadata({ ...meta, type: "prompt" }),
});

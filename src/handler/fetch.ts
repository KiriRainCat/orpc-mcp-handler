import type { Entry } from "./registry";
import type { MCPScope } from "@/mcp";
import type { ApprovalOptions } from "@/roundtrip/approval";
import type { Implementation, ServerContext } from "@modelcontextprotocol/server";
import type { JsonSchemaConverter } from "@orpc/json-schema";
import type { AnyRouter, Context, InferRouterInitialContext } from "@orpc/server";

import { createMcpHandler, McpServer, ProtocolError, ProtocolErrorCode, ResourceTemplate } from "@modelcontextprotocol/server";
import { call, toORPCError } from "@orpc/server";

import { MCP_SCOPE } from "@/mcp";
import { promptResult, resourceResult, toolResult } from "@/protocol/result";
import { projectSchema } from "@/protocol/schema";
import { createApproval, PendingInput } from "@/roundtrip/approval";

import { buildRegistry } from "./registry";

type ProjectedEntry = Entry & ReturnType<typeof projectSchema>;

/** Configuration shared by all requests handled by an MCP endpoint. */
export interface MCPHandlerOptions {
  /** Server identity advertised by the MCP SDK. */
  serverInfo: Implementation;

  /** Converters for explicitly declared oRPC schemas, tried in order. */
  converters?: JsonSchemaConverter[];

  /** Separator used to join router path segments; explicit metadata names take precedence. @default "." */
  nameSeparator?: string;

  /** Required when any exposed procedure declares approval. */
  approval?: ApprovalOptions;
}

/** Application-provided inputs for a single HTTP request. */
export interface MCPHandleOptions<TContext extends Context> {
  /** Initial oRPC context; middleware may enrich it before MCP confirmation. */
  context: TContext;

  /** Matches this path and its descendants; omitted means all paths. */
  prefix?: string;

  /** Snapshotted before execution. SDK headers win; Set-Cookie values are appended. */
  responseHeaders?: HeadersInit;
}

/** Exposes explicitly annotated oRPC procedures through the SDK's Fetch transport. */
export class MCPHandler<TRouter extends AnyRouter> {
  private registry?: Promise<ProjectedEntry[]>;
  private readonly approval;

  /** Creates a handler; lazy router resolution and registration run on the first matching request. */
  constructor(
    private readonly router: TRouter,
    private readonly options: MCPHandlerOptions,
  ) {
    this.approval = options.approval && createApproval(options.approval, options.serverInfo);
  }

  /** Returns an SDK response for matching paths, or `{ matched: false }` without loading the router. */
  async handle(request: Request, options: MCPHandleOptions<InferRouterInitialContext<TRouter>>) {
    const pathname = new URL(request.url).pathname;
    const prefix = (options.prefix ?? "").replace(/\/$/, "");
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return { matched: false as const };

    const extraHeaders = new Headers(options.responseHeaders);
    const entries = await (this.registry ??= buildRegistry(this.router, !!this.approval, this.options.nameSeparator).then((registry) =>
      registry.map((entry) => ({
        ...entry,
        ...projectSchema(entry, this.options.converters ?? []),
      })),
    ));

    const handler = createMcpHandler(
      () => {
        const server = new McpServer(this.options.serverInfo, {
          requestState: this.approval && { verify: this.approval.verify },
        });

        for (const entry of entries) {
          const { name, meta, input, output } = entry;
          const config = { title: meta.title, description: meta.description };

          if (meta.type === "tool") {
            server.registerTool(name, { ...config, inputSchema: input, outputSchema: output, annotations: meta.annotations }, (args, ctx) =>
              this.execute(entry, ctx, options.context, entry.mapInput(args), args, toolResult),
            );
          } else if (meta.type === "prompt") {
            server.registerPrompt(name, { ...config, argsSchema: input }, (args, ctx) =>
              this.execute(entry, ctx, options.context, entry.mapInput(args), args, promptResult),
            );
          } else {
            const resourceConfig = { ...config, mimeType: meta.mimeType };
            const convert = (uri: URL) => (value: unknown) => resourceResult(value, uri, meta.mimeType);
            if (meta.uri !== undefined) {
              server.registerResource(name, meta.uri, resourceConfig, (uri, ctx) =>
                this.execute(entry, ctx, options.context, undefined, { uri: uri.href }, convert(uri)),
              );
            } else {
              server.registerResource(
                name,
                new ResourceTemplate(meta.uriTemplate, { list: undefined }),
                resourceConfig,
                (uri, variables, ctx) => {
                  const args = Object.fromEntries(
                    Object.entries(variables).map(([key, value]) => {
                      if (typeof value !== "string") {
                        throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Resource variables must be strings.");
                      }
                      return [key, decodeURIComponent(value)];
                    }),
                  );
                  return this.execute(entry, ctx, options.context, args, { uri: uri.href }, convert(uri));
                },
              );
            }
          }
        }
        return server;
      },
      { legacy: "reject" },
    );

    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);

    for (const [name, value] of extraHeaders) if (name !== "set-cookie" && !headers.has(name)) headers.set(name, value);
    for (const cookie of extraHeaders.getSetCookie()) headers.append("set-cookie", cookie);

    return {
      matched: true as const,
      response: new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    };
  }

  private async execute<TResult>(
    entry: Entry,
    ctx: ServerContext,
    context: Context,
    input: unknown,
    wireInput: unknown,
    convert: (output: unknown) => TResult,
  ) {
    const scope: MCPScope = {
      context: ctx.mcpReq,
      approve: ({ context: currentContext, message }) => this.approval!.approve(entry, ctx, currentContext, wireInput, message),
    };

    try {
      ctx.mcpReq.signal.throwIfAborted();
      return convert(
        await call(entry.procedure, input, {
          context: { ...context, [MCP_SCOPE]: scope },
          path: entry.path,
          signal: ctx.mcpReq.signal,
        }),
      );
    } catch (error) {
      if (error instanceof PendingInput) return error.result;
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError(ProtocolErrorCode.InternalError, toORPCError(error).message);
    }
  }
}

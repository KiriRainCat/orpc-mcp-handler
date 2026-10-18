# orpc-mcp-handler

Expose [oRPC](https://orpc.dev) procedures as [MCP](https://modelcontextprotocol.io) tools, resources, and prompts. Reuse your validation, middleware, and business logic.

Supports MCP `2026-07-28` and oRPC v2 (`2.0.0-beta.42+`), using the official MCP TypeScript SDK.

## Usage

```ts
import { mcp } from "orpc-mcp-handler";

const removeUser = base
  .use(isAdmin)
  .use(mcp)
  .meta(mcp.tool({ approval: "Remove this user?" }))
  .input(RemoveUserInput)
  .output(RemoveUserOutput)
  .handler(removeUserHandler);
```

Place `.use(mcp)` after input and permission checks, before transactions or side effects. Retries repeat those checks.

However, placing `.use(mcp)` at the base level also works, but not recommended.

Ordinary RPC calls skip MCP confirmation automatically.

| Declaration                     | Input                                 | Result                                                       |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `mcp.tool()`                    | Object, or no input                   | JSON as `structuredContent` with matching text               |
| `mcp.resource({ uri })`         | Should not have input                 | String as `text/plain`; JSON as `application/json`           |
| `mcp.resource({ uriTemplate })` | String fields matching `{name}`       | String as `text/plain`; JSON as `application/json`           |
| `mcp.prompt()`                  | Flat string or optional string fields | String as one user message, or an explicit `GetPromptResult` |

Only annotated procedures are exposed. All declarations accept `name`, `title`, `description`, and `approval`; tools add `annotations`, resources add `mimeType`.

## Fetch handler

```ts
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { MCPHandler } from "orpc-mcp-handler/fetch";

const handler = new MCPHandler(router, {
  serverInfo: { name: "my-service", version: "1.0.0" },
  converters: [new ZodToJsonSchemaConverter()],
  nameSeparator: ".",
  approval: {
    key: approvalKey,
    subject: (context) => context.user.id,
  },
});

const result = await handler.handle(request, { prefix: "/mcp", context });
if (result.matched) return result.response;
```

Names default to router paths joined with `.`, such as `system.users.remove` from `/system/users/remove`.

Override `nameSeparator` or set an explicit metadata `name`. Names must be valid and unique within each capability type.

Supply your application's `context`. MCP calls add optional `context.mcp` with input responses, request state, and a cancellation signal.

`prefix` matches the path and its descendants; omitted, it matches all paths. Optional `responseHeaders` are snapshotted before execution. SDK headers take precedence; `Set-Cookie` values are appended.

## Human In the Loop

Set `approval` to `true` for the default prompt, a nonempty string to customize it, or `false` to disable inherited confirmation. The handler then requires:

- `key`: a stable secret of at least 32 bytes, shared across serving instances.
- `subject(context)`: a nonempty identity string, read after the middleware preceding `.use(mcp)`.

[Multi Round-Trip Requests (MRTR)](https://modelcontextprotocol.io/specification/draft/basic/patterns/mrtr) carry signed state bound to identity and arguments, valid for 10 minutes. Applications should handle authorization, replay protection, and idempotency.

Broad `catch` blocks must preserve the internal MRTR control signal.

## Constraints

- Use at most one input and one output schema. Omit `.input()` for no input; otherwise supply an object schema and a matching converter. No fallback conversion is applied.
- Resource templates support simple `{name}` variables and no extra required fields. URIs are normalized; static resources take priority, then templates in registration order. Variables are percent-decoded once.
- oRPC validates outputs before conversion. Dates serialize to ISO strings; date inputs are not coerced. Optional tool outputs omit the MCP output schema but retain oRPC validation.
- `undefined` produces empty tool/resource content. Other JSON values, including `null`, `false`, `0`, and empty strings, are preserved. Objects are never guessed to be native MCP results.

## Development

```sh
vp install
vp check
vp pack
```

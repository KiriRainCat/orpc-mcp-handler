# AGENTS.md

- This project uses `bun` as its runtime and package manager.

## Using `vp` (vite-plus)

- This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task.
- `vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task.
- Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Architecture

- Keep the oRPC consumer baseline at `2.0.0-beta.42` and above; preserve its schema validation and middleware behavior.
- Support latest MCP protocol with the official TypeScript SDK; create the handler with `legacy: "reject"` and do not add legacy negotiation.
- Preserve preceding middleware order. Any broad `catch` around `mcp` must rethrow the private `Multi Round-Trip Requests` control signal unchanged.
- Do not use the catalog as a permission filter. Applications provide authorization middleware and protect the HTTP route when catalog access needs protection.
- Approval signatures bind identity and request parameters. Require a key of at least 32 bytes, and do not promise one-time consumption or exactly-once execution.

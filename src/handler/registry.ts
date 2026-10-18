import type { MCPMeta } from "@/mcp";
import type { AnyProcedure, AnyRouter } from "@orpc/server";

import { UriTemplate } from "@modelcontextprotocol/server";
import { getRouter, Procedure, unlazyRouter, walkProcedureContractsAsync } from "@orpc/server";

import { mcp } from "@/mcp";

export interface Entry {
  name: string;
  meta: MCPMeta;
  path: string[];
  procedure: AnyProcedure;
}

export async function buildRegistry(router: AnyRouter, approvalConfigured: boolean, nameSeparator = "."): Promise<Entry[]> {
  const entries: Entry[] = [];
  const names = { tool: new Set<string>(), resource: new Set<string>(), prompt: new Set<string>() };
  const resourceUris = new Set<string>();
  const resourceTemplates = new Set<string>();
  const resolved = await unlazyRouter(router);

  await walkProcedureContractsAsync(resolved, (contract, path) => {
    let meta = contract["~orpc"].meta["~mcp"] as MCPMeta | undefined;
    if (!meta) return;

    const location = path.join(".") || "<root>";
    const procedure = getRouter(resolved, path);

    if (!(procedure instanceof Procedure)) {
      throw new TypeError(`MCP procedure ${location} has no implementation.`);
    }
    if (!procedure["~orpc"].orderedMiddlewares.some(({ middleware }) => middleware === mcp)) {
      throw new TypeError(`MCP procedure ${location} must use .use(mcp).`);
    }
    if (meta.approval && !approvalConfigured) {
      throw new TypeError(`MCP procedure ${location} requires approval configuration.`);
    }

    const name = meta.name ?? path.join(nameSeparator);

    if (!name.trim()) {
      throw new TypeError(`MCP procedure ${location} must have a non-empty name.`);
    }
    if (meta.type === "tool" && !/^[A-Za-z0-9._-]{1,128}$/.test(name)) {
      throw new TypeError(`MCP tool ${location} must have a name of 1-128 letters, digits, _, -, or .`);
    }
    if (names[meta.type].has(name)) {
      throw new TypeError(`Duplicate MCP ${meta.type} name ${name} at ${location}.`);
    }

    names[meta.type].add(name);

    if (meta.type === "resource") {
      if (meta.uri !== undefined) {
        const uri = new URL(meta.uri).href;
        if (resourceUris.has(uri)) throw new TypeError(`Duplicate MCP resource URI ${uri} at ${location}.`);
        resourceUris.add(uri);
        meta = { ...meta, uri };
      } else {
        const source = meta.uriTemplate;
        const literals = source.replace(/\{[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}/g, "");
        if (literals === source || /[{}]/.test(literals)) {
          throw new TypeError(`MCP resource ${location} supports only simple {name} URI expressions.`);
        }

        const template = new UriTemplate(source);
        const prefix = `orpc-${crypto.randomUUID()}`;

        const placeholders = [...new Set(template.variableNames)].map((variable, index) => [variable, `${prefix}-${index}`] as const);
        let normalized = new URL(template.expand(Object.fromEntries(placeholders))).href;

        for (const [variable, placeholder] of placeholders) {
          normalized = normalized.replaceAll(placeholder, `{${variable}}`);
        }

        const normalizedTemplate = new UriTemplate(normalized).toString();
        if (resourceTemplates.has(normalizedTemplate)) {
          throw new TypeError(`Duplicate MCP resource template ${normalizedTemplate} at ${location}.`);
        }

        resourceTemplates.add(normalizedTemplate);
        meta = { ...meta, uriTemplate: normalizedTemplate };
      }
    }

    entries.push({ procedure, path, name, meta });
  });

  return entries;
}

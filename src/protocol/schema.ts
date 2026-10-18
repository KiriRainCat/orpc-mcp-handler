import type { Entry } from "@/handler/registry";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from "@orpc/json-schema";
import type { AnySchema } from "@orpc/server";

import { fromJsonSchema, UriTemplate } from "@modelcontextprotocol/server";
import { ensureJsonSchemaObject, extractJsonObjectSchemaEntries, resolveJsonSchemaRootLocalRef } from "@orpc/json-schema";

export function projectSchema(entry: Entry, converters: JsonSchemaConverter[]) {
  const location = entry.path.join(".") || "<root>";
  const { inputSchemas = [], outputSchemas = [] } = entry.procedure["~orpc"];

  const fail: (message: string) => never = (message) => {
    throw new TypeError(`MCP procedure ${location}: ${message}`);
  };

  if (inputSchemas.length > 1 || outputSchemas.length > 1) {
    fail("multiple input or output schemas are not supported.");
  }

  const convert = (schema: AnySchema, direction: JsonSchemaConverterDirection) => {
    const converter = converters.find((candidate) => candidate.condition(schema, direction));
    if (!converter) return fail(`no JSON Schema converter supports its ${direction} schema.`);

    try {
      return converter.convert(schema, direction);
    } catch (cause) {
      throw new TypeError(`MCP procedure ${location}: could not convert its ${direction} schema.`, { cause });
    }
  };

  let jsonInput: JsonSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  if (inputSchemas[0]) {
    jsonInput = resolveJsonSchemaRootLocalRef(convert(inputSchemas[0], "input")[0]);
  }

  if (typeof jsonInput !== "object" || jsonInput.type !== "object") {
    fail("input must describe an object; omit .input() for a procedure without input.");
  }

  if (entry.meta.type === "prompt" || entry.meta.type === "resource") {
    const fields = extractJsonObjectSchemaEntries(jsonInput);
    if (!fields) fail("input must describe an object with string fields.");

    for (const [name, schema] of fields) {
      const field = resolveJsonSchemaRootLocalRef(schema);
      if (typeof field !== "object" || field.type !== "string") {
        fail(`input field ${name} must be a string.`);
      }
    }

    if (entry.meta.type === "prompt") {
      jsonInput = {
        ...jsonInput,
        properties: Object.fromEntries(fields.map(([name, schema]) => [name, schema])),
        required: fields.filter(([, , optional]) => !optional).map(([name]) => name),
      };
    }

    if (entry.meta.type === "resource") {
      if (entry.meta.uri !== undefined) {
        if (inputSchemas.length) fail("a static resource must omit .input().");
      } else {
        const variables = new UriTemplate(entry.meta.uriTemplate).variableNames;
        for (const variable of variables) {
          if (!fields.some(([name]) => name === variable)) {
            fail(`resource template variable ${variable} must have a string input field.`);
          }
        }

        for (const [name, , optional] of fields) {
          if (!optional && !variables.includes(name)) {
            fail(`required input field ${name} is missing from the resource template.`);
          }
        }
      }
    }
  }

  const outputs = entry.meta.type === "tool" && outputSchemas[0] ? convert(outputSchemas[0], "output") : undefined;

  return {
    // Both packages use draft 2020-12, but their $vocabulary declarations differ.
    input: fromJsonSchema<Record<string, unknown>>(jsonInput as unknown as JsonSchemaType),
    output: outputs && !outputs[1] ? fromJsonSchema(ensureJsonSchemaObject(outputs[0]) as unknown as JsonSchemaType) : undefined,
    mapInput: (input: Record<string, unknown>): unknown => (inputSchemas.length ? input : undefined),
  };
}

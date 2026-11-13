/**
 * provider.ts — AI provider abstraction.
 *
 * Exports completeJSON(prompt, zodSchema, schemaName) which:
 *  - Calls the selected provider (AI_PROVIDER env var: 'mock' | 'grok')
 *  - Validates the response with Zod
 *  - Retries once on invalid JSON or 5xx/429 (waits 2 s before retry)
 *  - Throws a clear error on second failure
 *  - Never logs the API key
 */

import * as z from 'zod';

// ── JSON Schema generation from Zod ──────────────────────────────────────────

type JsonSchemaType =
  | { type: 'string'; enum?: string[] }
  | { type: 'integer' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'null' }
  | { type: 'object'; properties: Record<string, JsonSchemaType>; required: string[]; additionalProperties: false }
  | { anyOf: JsonSchemaType[] };

/**
 * Convert a Zod schema to a JSON Schema object.
 * Only types, enums and required fields — no min/max length constraints.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: z.ZodType<any>): JsonSchemaType {
  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (schema instanceof z.ZodBigInt) {
    return { type: 'integer' };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodNull) {
    return { type: 'null' };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options as string[] };
  }
  if (schema instanceof z.ZodNullable) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = zodToJsonSchema(schema.unwrap() as z.ZodType<any>);
    return { anyOf: [inner, { type: 'null' }] };
  }
  if (schema instanceof z.ZodOptional) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return zodToJsonSchema(schema.unwrap() as z.ZodType<any>);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>;
    const properties: Record<string, JsonSchemaType> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      // A field is required unless it's explicitly optional or has a default
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }
  // Fallback — treat as string
  return { type: 'string' };
}

// ── Retry helper ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Grok provider ─────────────────────────────────────────────────────────────

async function callGrok(
  prompt: string,
  jsonSchema: JsonSchemaType,
  schemaName: string,
): Promise<unknown> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY env var is required when AI_PROVIDER=grok');

  const model = process.env.GROK_MODEL ?? 'grok-3-mini';

  const body = {
    model,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        schema: jsonSchema,
        strict: true,
      },
    },
  };

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Authorization header — API key is never echoed to logs
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Grok API error ${res.status}: ${text.slice(0, 200)}`),
      { status: res.status },
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Grok response missing choices[0].message.content');
  }

  return JSON.parse(content);
}

// ── Mock provider ─────────────────────────────────────────────────────────────

/**
 * Deterministic, offline mock.
 * Returns a valid instance of the schema for use in tests and local dev.
 * The result is derived purely from the schema — no randomness.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockComplete(schema: z.ZodType<any>): unknown {
  if (schema instanceof z.ZodString) return 'mock-string';
  if (schema instanceof z.ZodNumber) return 0;
  if (schema instanceof z.ZodBigInt) return BigInt(0);
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodNull) return null;
  if (schema instanceof z.ZodEnum) return (schema.options as string[])[0];
  if (schema instanceof z.ZodNullable) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (schema instanceof z.ZodOptional) return mockComplete(schema.unwrap() as z.ZodType<any>);
  if (schema instanceof z.ZodDefault) {
    const def = schema._def as { defaultValue: unknown };
    return typeof def.defaultValue === 'function'
      ? (def.defaultValue as () => unknown)()
      : def.defaultValue;
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType<unknown>>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shape)) {
      result[key] = mockComplete(value);
    }
    return result;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Complete a JSON response from the active AI provider.
 *
 * @param prompt      The user prompt to send to the model.
 * @param zodSchema   Zod object schema; used both for JSON Schema generation
 *                    (Grok structured output) and for response validation.
 * @param schemaName  Name for the JSON schema (used by Grok's response_format).
 * @returns           A validated, typed object matching the schema.
 */
export async function completeJSON<T extends z.ZodType<unknown>>(
  prompt: string,
  zodSchema: T,
  schemaName: string,
): Promise<z.infer<T>> {
  const provider = process.env.AI_PROVIDER ?? 'mock';

  async function attempt(): Promise<unknown> {
    if (provider === 'grok') {
      const jsonSchema = zodToJsonSchema(zodSchema);
      return callGrok(prompt, jsonSchema, schemaName);
    }
    // mock (and any unknown value falls back to mock)
    return mockComplete(zodSchema);
  }

  let raw: unknown;
  try {
    raw = await attempt();
  } catch (err) {
    const isRetryable =
      err instanceof SyntaxError ||
      (err instanceof Error &&
        'status' in err &&
        typeof (err as { status?: number }).status === 'number' &&
        ((err as { status: number }).status >= 500 ||
          (err as { status: number }).status === 429));

    if (!isRetryable) throw err;

    await sleep(2000);
    raw = await attempt(); // second attempt — let it throw if it fails again
  }

  // Validate with Zod
  let parsed: z.infer<T>;
  try {
    parsed = zodSchema.parse(raw) as z.infer<T>;
  } catch (_parseErr) {
    // One retry after a Zod validation failure
    await sleep(2000);
    const raw2 = await attempt();
    parsed = zodSchema.parse(raw2) as z.infer<T>;
  }

  return parsed;
}

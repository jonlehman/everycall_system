import { z } from "zod";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const OPENAI_JSON_TIMEOUT_MS = readPositiveIntEnv("OPENAI_JSON_TIMEOUT_MS", 90_000);
const OPENAI_EMBED_TIMEOUT_MS = readPositiveIntEnv("OPENAI_EMBED_TIMEOUT_MS", 120_000);
const OPENAI_EMBED_BATCH_SIZE = readPositiveIntEnv("OPENAI_EMBED_BATCH_SIZE", 96);
const OPENAI_EMBED_BATCH_CONCURRENCY = readPositiveIntEnv("OPENAI_EMBED_BATCH_CONCURRENCY", 4);
const OPENAI_JSON_MAX_ATTEMPTS = readPositiveIntEnv("OPENAI_JSON_MAX_ATTEMPTS", 2);
const OPENAI_BUILD_PROMPT_CACHE_RETENTION = normalizeText(process.env.OPENAI_BUILD_PROMPT_CACHE_RETENTION);

type JsonSchema = Record<string, unknown>;

function shouldOmitResponsesTemperature(model: string) {
  return normalizeText(model).toLowerCase().startsWith("gpt-5");
}

function shouldUseResponsesReasoningNone(model: string) {
  return normalizeText(model).toLowerCase().startsWith("gpt-5");
}

function truncateForError(value: unknown, maxLength = 400) {
  const text = normalizeText(typeof value === "string" ? value : JSON.stringify(value));
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractResponseRefusal(json: any) {
  const refusal = Array.isArray(json?.output)
    ? json.output
        .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .find((item: any) => item?.type === "refusal" && typeof item?.refusal === "string")
        ?.refusal
    : "";
  return normalizeText(refusal);
}

function summarizeOutputTypes(json: any) {
  if (!Array.isArray(json?.output)) return [];
  return json.output
    .flatMap((item: any) => {
      const itemTypes = [normalizeText(item?.type)];
      const contentTypes = Array.isArray(item?.content)
        ? item.content.map((content: any) => normalizeText(content?.type))
        : [];
      return [...itemTypes, ...contentTypes];
    })
    .filter(Boolean);
}

function buildStructuredOutputError(json: any) {
  const refusal = extractResponseRefusal(json);
  if (refusal) {
    return new Error(`openai_json_model_refusal:${truncateForError(refusal)}`);
  }
  const status = normalizeText(json?.status);
  const incompleteDetails = json?.incomplete_details;
  if (status === "incomplete") {
    return new Error(`openai_json_model_incomplete:${truncateForError(incompleteDetails || "unknown")}`);
  }
  const outputTypes = summarizeOutputTypes(json);
  return new Error(
    `openai_json_model_empty_output:status=${status || "unknown"}:output_types=${truncateForError(outputTypes)}:response=${truncateForError({
      status: json?.status,
      incomplete_details: json?.incomplete_details,
      error: json?.error,
      output: json?.output
    })}`
  );
}

function extractUsage(json: any) {
  if (json?.usage && typeof json.usage === "object" && !Array.isArray(json.usage)) {
    return {
      available: true,
      ...json.usage
    };
  }
  return {
    available: false
  };
}

function extractJsonText(rawText: string) {
  const trimmed = normalizeText(rawText);
  if (!trimmed) {
    throw new Error("empty_model_output");
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }
  throw new Error("json_output_not_found");
}

function resolveResponseText(json: any) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text;
  }
  const outputJson = Array.isArray(json?.output)
    ? json.output
        .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .find((item: any) => item?.type === "output_json" && item?.json)
        ?.json
    : null;
  if (outputJson) {
    return JSON.stringify(outputJson);
  }
  const responseText = Array.isArray(json?.output)
    ? json.output
      .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .find((item: any) => item?.type === "output_text" && typeof item?.text === "string")
      ?.text
    : "";
  const normalized = normalizeText(responseText);
  if (normalized) {
    return normalized;
  }
  throw buildStructuredOutputError(json);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const currentItem = items[currentIndex];
      if (currentItem === undefined) continue;
      results[currentIndex] = await worker(currentItem, currentIndex);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => run()));
  return results;
}

export async function callOpenAiJsonModel<T>(input: {
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodSchema<T>;
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchemaName?: string;
  jsonSchema?: JsonSchema;
  promptCacheKey?: string;
  promptCacheRetention?: string;
}): Promise<{
  parsed: T;
  usage: Record<string, unknown>;
  responseId: string | null;
  model: string;
  rawResponse: unknown;
}> {
  const apiKey = normalizeText(input.apiKey || process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("openai_api_key_missing");
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= OPENAI_JSON_MAX_ATTEMPTS; attempt += 1) {
    const system = attempt === 1
      ? input.system
      : `${input.system}\nReturn syntactically valid JSON only. Double-check commas, brackets, and quotes before responding.`;
    try {
      const requestBody = buildOpenAiJsonResponseRequestBody({
        model: input.model,
        system,
        user: input.user,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        ...(input.jsonSchemaName === undefined ? {} : { jsonSchemaName: input.jsonSchemaName }),
        ...(input.jsonSchema === undefined ? {} : { jsonSchema: input.jsonSchema }),
        ...(input.promptCacheKey === undefined ? {} : { promptCacheKey: input.promptCacheKey }),
        ...(input.promptCacheRetention === undefined ? {} : { promptCacheRetention: input.promptCacheRetention })
      });
      const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }, OPENAI_JSON_TIMEOUT_MS);

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`openai_json_model_failed:${response.status}:${bodyText.slice(0, 400)}`);
      }

      const json = await response.json();
      const rawText = resolveResponseText(json);
      const extracted = extractJsonText(rawText);
      const parsed = JSON.parse(extracted);
      return {
        parsed: input.schema.parse(parsed),
        usage: extractUsage(json),
        responseId: normalizeText(json?.id) || null,
        model: normalizeText(json?.model) || input.model,
        rawResponse: json
      };
    } catch (err) {
      lastError = err;
      if (attempt >= OPENAI_JSON_MAX_ATTEMPTS) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("openai_json_model_failed:unknown");
}

export type OpenAiEmbeddingResult = {
  index: number;
  embedding: number[];
};

export async function embedOpenAiTextsDetailed(input: {
  apiKey?: string;
  model?: string;
  texts: string[];
}) {
  const apiKey = normalizeText(input.apiKey || process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("openai_api_key_missing");
  }
  const texts = input.texts.map((text) => normalizeText(text)).filter(Boolean);
  if (!texts.length) {
    return {
      items: [] as OpenAiEmbeddingResult[],
      rawResponses: [] as unknown[]
    };
  }

  const model = input.model || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const batches = [];
  for (let index = 0; index < texts.length; index += OPENAI_EMBED_BATCH_SIZE) {
    batches.push({
      startIndex: index,
      texts: texts.slice(index, index + OPENAI_EMBED_BATCH_SIZE)
    });
  }

  const embeddedBatches = await mapWithConcurrency(
    batches,
    OPENAI_EMBED_BATCH_CONCURRENCY,
    async (batch) => {
      const requestBody = buildOpenAiEmbeddingsRequestBody({
        model,
        texts: batch.texts
      });
      const response = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }, OPENAI_EMBED_TIMEOUT_MS);

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`openai_embeddings_failed:${response.status}:${bodyText.slice(0, 400)}`);
      }

      const json = await response.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      return {
        rawResponse: json,
        items: rows
          .sort((left: any, right: any) => Number(left?.index || 0) - Number(right?.index || 0))
          .map((item: any, batchIndex: number) => ({
            index: batch.startIndex + batchIndex,
            embedding: Array.isArray(item?.embedding) ? item.embedding.map((value: any) => Number(value || 0)) : []
          }))
      };
    }
  );

  return {
    items: embeddedBatches
      .flatMap((batch) => batch.items)
      .sort((left, right) => left.index - right.index),
    rawResponses: embeddedBatches.map((batch) => batch.rawResponse)
  };
}

export async function embedOpenAiTexts(input: {
  apiKey?: string;
  model?: string;
  texts: string[];
}) {
  const detailed = await embedOpenAiTextsDetailed(input);
  return detailed.items;
}

export function buildOpenAiJsonResponseRequestBody(input: {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchemaName?: string;
  jsonSchema?: JsonSchema;
  promptCacheKey?: string;
  promptCacheRetention?: string;
}) {
  const model = normalizeText(input.model);
  const temperature = input.temperature ?? 0;
  return {
    model,
    ...(shouldOmitResponsesTemperature(model)
      ? {}
      : { temperature }),
    max_output_tokens: input.maxOutputTokens ?? 1400,
    ...(shouldUseResponsesReasoningNone(model)
      ? { reasoning: { effort: "minimal" } }
      : {}),
    ...(normalizeText(input.promptCacheKey) ? { prompt_cache_key: normalizeText(input.promptCacheKey) } : {}),
    ...(normalizeText(input.promptCacheRetention || OPENAI_BUILD_PROMPT_CACHE_RETENTION)
      ? { prompt_cache_retention: normalizeText(input.promptCacheRetention || OPENAI_BUILD_PROMPT_CACHE_RETENTION) }
      : {}),
    ...(input.jsonSchema
      ? {
          text: {
            format: {
              type: "json_schema",
              name: normalizeText(input.jsonSchemaName) || "structured_output",
              schema: input.jsonSchema,
              strict: true
            }
          }
        }
      : {}),
    input: [
      { role: "system", content: input.system },
      { role: "user", content: input.user }
    ]
  };
}

export function buildOpenAiEmbeddingsRequestBody(input: {
  model?: string;
  texts: string[];
}) {
  return {
    model: input.model || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: input.texts.map((text) => normalizeText(text)).filter(Boolean)
  };
}

# Poe API Reference — BathyScan

This file documents the `@workspace/poe` wrapper used by all AI features in BathyScan. **Never import `openai` or any other AI SDK directly in route handlers or frontend code.** All calls go through this wrapper.

---

## Package location

```
lib/poe/src/
  client.ts       — getPoeClient() singleton (reads POE_API_KEY secret)
  models.ts       — POE_MODELS constant + MODEL_DEFAULTS capability table
  types.ts        — PoeMessage, PoeCompleteParams, PoeRespondParams, PoeResponseResult, etc.
  completions.ts  — poeComplete() — Chat Completions API (non-streaming)
  responses.ts    — poeRespond() — Responses API (structured JSON, multi-turn, tools)
  streaming.ts    — poeStream(), pipeStreamToResponse() — SSE streaming
  vision.ts       — buildVisionInput() — wraps base64 image for vision models
  tools.ts        — PoeToolSchema type helpers
  cache.ts        — PoeCache class, hashCacheKey(), globalPoeCache singleton
  retry.ts        — withRetry(fn, maxAttempts)
  errors.ts       — PoeCreditsError, PoeRateLimitError, PoeAuthError, ZoneParseError
```

---

## Model aliases

Always use the `POE_MODELS` constants instead of hard-coding model name strings. This ensures a single place to update when models are rotated.

```ts
import { POE_MODELS } from "@workspace/poe";

POE_MODELS.CLASSIFY        // "Claude-Sonnet-4.6"  — vision + JSON schema
POE_MODELS.QUERY_TOOLS     // "Claude-Sonnet-4.6"  — tool-calling, multi-turn
POE_MODELS.DESCRIBE_QUICK  // "Claude-Haiku-4.5"   — fast streaming descriptions
POE_MODELS.REASON_DEEP     // "Claude-Opus-4.7"    — deep reasoning, expensive
POE_MODELS.QUERY_MULTI     // "Claude-Sonnet-4.6"  — conversation history
POE_MODELS.FRESHWATER_CLASS// "Claude-Sonnet-4.6"  — freshwater zone classification
```

### Full model catalogue (as of May 2026)

| Model name | Points/1k tokens | Vision | Tools | Reasoning | Context |
|---|---|---|---|---|---|
| `Claude-Opus-4.7` | 30 | ✓ | ✓ | ✓ | 200k |
| `Claude-Sonnet-4.6` | 6 | ✓ | ✓ | ✓ | 200k |
| `Claude-Sonnet-4.5` | 6 | ✓ | ✓ | ✓ | 200k |
| `Claude-Haiku-4.5` | 1 | ✓ | ✓ | — | 200k |
| `GPT-5-Pro` | 20 | ✓ | ✓ | ✓ | 128k |
| `GPT-5.4` | 10 | ✓ | ✓ | ✓ | 128k |
| `GPT-5-Codex` | — | ✓ | ✓ | — | 128k |
| `Gemini-3.1-Pro` | 5 | ✓ | ✓ | — | 1M |
| `Gemini-2.5-Pro` | 5 | ✓ | ✓ | — | 1M |
| `Grok-4` | 8 | ✓ | ✓ | — | 128k |
| `DeepSeek-R1` | 3 | — | ✓ | ✓ | 64k |

---

## Responses API — `poeRespond()`

Use for: structured JSON output, tool-calling, multi-turn conversation with `previousResponseId`.

```ts
import { poeRespond, POE_MODELS } from "@workspace/poe";
import type { PoeRespondParams } from "@workspace/poe";

const params: PoeRespondParams = {
  model: POE_MODELS.QUERY_TOOLS,
  input: [
    { role: "user", content: "What is the water depth here?" }
  ],                                // string | ResponsesInputItem[]
  instructions: "System prompt here",
  temperature: 0.3,                 // default varies by model
  maxOutputTokens: 1024,
  previousResponseId: "resp_abc",   // omit for first turn
  truncation: "auto",               // "auto" | "disabled"
  tools: BATHYSCAN_TOOLS,           // optional PoeToolSchema[]
  jsonSchema: {                     // omit for plain text
    name: "my_schema",
    schema: { type: "object", ... },
    strict: true,
    zodSchema: MyZodSchema,         // optional runtime validation
  },
  metadata: { datasetId: "xyz" },   // optional string record
};

const result = await poeRespond(params);
// result.text    — string (raw or JSON string)
// result.id      — response id for multi-turn chaining
// result.usage.inputTokens / outputTokens
```

### JSON Schema output

When `jsonSchema` is provided, `poeRespond()` enforces `text.format.type = "json_schema"` on the Poe request. If `zodSchema` is also provided, the parsed object is validated at runtime and `ZoneParseError` is thrown on mismatch.

---

## Completions API — `poeComplete()`

Use for: simple non-streaming text, when the Responses API is not needed.

```ts
import { poeComplete, POE_MODELS } from "@workspace/poe";
import type { PoeCompleteParams } from "@workspace/poe";

const params: PoeCompleteParams = {
  model: POE_MODELS.DESCRIBE_QUICK,
  messages: [
    { role: "system", content: "You are a concise marine geologist." },
    { role: "user",   content: "Describe this zone." },
  ],
  temperature: 0.5,
  maxTokens: 512,
  stop: ["\n\n"],       // optional stop sequences
  tools: [],            // optional tool schemas
  toolChoice: "auto",
};

const result = await poeComplete(params);
// result.text       — string | null
// result.toolCalls  — ToolCall[]
// result.rawMessage — OpenAI.ChatCompletionMessage
```

---

## Streaming API — `pipeStreamToResponse()`

Use for: SSE endpoints where the frontend reads streamed tokens progressively.

```ts
import { pipeStreamToResponse, POE_MODELS } from "@workspace/poe";

// Inside an Express route handler:
await pipeStreamToResponse(
  {
    model: POE_MODELS.DESCRIBE_QUICK,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user",   content: userMsg },
    ],
    temperature: 0.7,
    maxTokens: 256,
  },
  res,  // Express Response — pipeStreamToResponse sets SSE headers automatically
);
// Each chunk is sent as: data: {"delta":"token"}\n\n
// Ends with: data: [DONE]\n\n
```

For manual iteration: use `poeStream(params)` which is an `AsyncGenerator<string>`.

---

## Vision input — `buildVisionInput()`

Use when the model needs to see an image (e.g., depth map PNG).

```ts
import { buildVisionInput } from "@workspace/poe";

// base64 = a base64-encoded PNG/JPEG string (no data: prefix needed)
const input = buildVisionInput("Describe what you see in this depth map.", base64);
// Returns ResponsesInputItem[] ready for poeRespond({ input })
```

---

## Tool definitions — `PoeToolSchema`

```ts
import type { PoeToolSchema } from "@workspace/poe";

const myTool: PoeToolSchema = {
  type: "function",
  function: {
    name: "navigateToLocation",
    description: "Move the 3D camera to a specific geographical location",
    parameters: {
      type: "object",
      properties: {
        lon: { type: "number" },
        lat: { type: "number" },
      },
      required: ["lon", "lat"],
      additionalProperties: false,
    },
  },
};
```

Pass `tools` to `poeRespond()` or `poeComplete()`. Tool call results come back in `result.toolCalls` (Completions API) or in `response.output` filtered by `item.type === "function_call"` (raw Responses API).

---

## Retry — `withRetry()`

Wrap every Poe call in `withRetry` to handle transient network errors and Poe rate limits.

```ts
import { withRetry } from "@workspace/poe";

const result = await withRetry(() => poeRespond(params), 3);
//                                                        ^ maxAttempts
```

`withRetry` re-throws `PoeCreditsError` and `PoeAuthError` immediately (no retry — user action required).

---

## Caching — `globalPoeCache` + `hashCacheKey()`

The global in-memory LRU cache has a 30-minute TTL and a 100-entry cap.

```ts
import { globalPoeCache, hashCacheKey } from "@workspace/poe";

// Generate a deterministic cache key from multiple parts:
const key = hashCacheKey(datasetId, waterType, gridBase64);

// Check before calling Poe:
const hit = globalPoeCache.get(key);
if (hit) return JSON.parse(hit);

// Store after a successful call:
globalPoeCache.set(key, JSON.stringify(result));
```

For zone classifications, a secondary disk-backed cache (`/tmp/zone-cache/<gridHash>.json`) is used so results survive process restarts. See `readZoneDiskByHash()` / `writeZoneDisk()` in `artifacts/api-server/src/routes/poe.ts`.

---

## Usage logging — `logUsage()`

Every successful Poe call MUST log usage to `poe_usage_log`. The helper is defined locally in `poe.ts` but follows this pattern:

```ts
await db.insert(poeUsageLogTable).values({
  userId,
  model,
  endpoint,         // "classify" | "query" | "describe" | etc.
  promptTokens: result.usage.inputTokens,
  completionTokens: result.usage.outputTokens,
  totalTokens: result.usage.inputTokens + result.usage.outputTokens,
  estimatedPoints: estimatePoints(model, totalTokens),
});
```

`estimatePoints(model, totalTokens)` = `ceil((totalTokens / 1000) * POINTS_PER_TOKEN[model])` where the points table lives at the top of `poe.ts`. Keep it in sync when new models are added to `POE_MODELS`.

---

## Error handling

```ts
import { PoeCreditsError, PoeRateLimitError, PoeAuthError } from "@workspace/poe";

function handlePoeError(err: unknown, res: Response): void {
  if (err instanceof PoeCreditsError) {
    res.status(402).json({ error: "credits_exhausted", message: err.message });
  } else if (err instanceof PoeRateLimitError) {
    res.status(429).json({ error: "rate_limit", message: err.message });
  } else if (err instanceof PoeAuthError) {
    res.status(401).json({ error: "auth_error", message: "AI service authentication failed" });
  } else {
    const msg = err instanceof Error ? err.message : "Unknown Poe API error";
    res.status(500).json({ error: "poe_error", message: msg });
  }
}
```

Always use this pattern — do not swallow errors silently.

---

## Checklist for a new AI route

- [ ] Model chosen from `POE_MODELS` (not a hard-coded string)
- [ ] Call wrapped in `withRetry(fn, 3)`
- [ ] Cache checked before calling, result stored after
- [ ] `logUsage()` called on success
- [ ] `handlePoeError()` called in the catch block
- [ ] Rate limit check (`checkRateLimit(userId)`) before calling
- [ ] Endpoint added to OpenAPI spec in `lib/api-spec/openapi.yaml`
- [ ] Vitest unit test added

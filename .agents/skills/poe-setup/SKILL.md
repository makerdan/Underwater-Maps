---
name: Poe-Setup
description: >-
  Self-contained guide for integrating the Poe API into any JavaScript or
  TypeScript Replit app. Use it whenever an app needs Poe models, an
  OpenAI-compatible client, structured output, tool calling, vision, or
  streamed AI responses. Covers provider-wrapper selection, secret handling,
  live model discovery, resilient server routes, and portable testing without
  assuming any existing app architecture.
---

# Poe API Integration — Portable Setup Guide

Poe exposes an OpenAI-compatible API at `https://api.poe.com/v1`. The endpoint
is compatible with common OpenAI SDK request shapes, but compatibility does not
mean every model supports every capability. Discover the live catalogue and
follow the capability metadata and current Poe documentation for the model
actually selected.

## 1. Choose the integration layer first

Before installing an SDK or writing a direct Poe call, inspect the repository
for an existing provider abstraction. Search for names such as `ai`,
`providers`, `llm`, `inference`, `getClient`, or `complete`, and look for
service factories, model registries, retry/caching helpers, and error types.
Read the local usage and tests before choosing an implementation.

Use an existing provider/client abstraction when one is present. Add Poe as a
provider behind that boundary instead of bypassing it from a route or browser
component. This preserves the app's existing authentication, retries,
telemetry, caching, rate limits, and error contract, and prevents multiple
clients from handling the same secret differently.

Only use the raw OpenAI-compatible SDK fallback below when no suitable
abstraction exists, or when the abstraction explicitly delegates client
creation to it. Do not install a second SDK or create a second provider
singleton merely because a route needs a new model capability.

## 2. Store the API key as a Replit Secret

1. Open the **Secrets** panel in the Replit workspace.
2. Add a secret named **`POE_API_KEY`** and paste the key as its value.
3. Read it only in server-side code as `process.env.POE_API_KEY`.

Never hard-code the key, commit it, include it in a client bundle, put it in
browser local storage, or return it in an error/log response. Do not ask a user
to paste a secret into chat. If the app already uses a secret-management or
provider configuration layer, follow that layer's naming and validation
conventions instead of exposing the key to application code.

## 3. Raw SDK fallback

If no provider abstraction exists, install the standard OpenAI Node SDK from
the app's package manager:

```bash
pnpm add openai
```

Instantiate it once in a server-only module. Fail clearly when the secret is
missing rather than silently constructing a client that will fail much later.

```ts
import OpenAI from "openai";

const apiKey = process.env.POE_API_KEY;
if (!apiKey) {
  throw new Error("POE_API_KEY is not configured on the server");
}

export const poe = new OpenAI({
  apiKey,
  baseURL: "https://api.poe.com/v1",
  timeout: 30_000,
});
```

Keep client construction, timeout defaults, and provider-specific error
classification in one module. Routes should call the provider boundary, not
reconstruct clients or read secrets themselves.

## 4. Discover the live model catalogue

The live `GET /v1/models` response is authoritative for model IDs and current
availability. Query it at runtime for setup/model-picker workflows and refresh
it with a short server-side cache when appropriate. Treat any model table in
this guide or in application documentation as illustrative only, never as a
permanent availability claim.

```ts
const modelsPage = await poe.models.list();
const models = modelsPage.data.map((model) => ({
  id: model.id,
}));
```

Send the returned ID verbatim. Do not normalize case, infer aliases, or assume
that an ID from an old example still exists. The standard OpenAI SDK's `Model`
type guarantees fields such as `id`, but it does not guarantee Poe-specific
capability metadata. If the live payload includes extra capability fields,
parse and validate that provider-specific payload into the app's own schema
before using it. Otherwise consult current provider documentation and handle
an unsupported-capability response explicitly rather than guessing.

For documentation and tests, examples such as `Claude-Sonnet-4.6` or `GPT-4o`
may be used as placeholders, but label them as examples and keep production
defaults in configuration or a live model-selection layer.

## 5. Completions and modern capabilities

Use the existing provider's equivalent methods when it has them. With the raw
client, use Chat Completions for simple text and use the Responses-style API
when the current model and endpoint support structured output, multi-turn
state, or tools.

### Simple non-streaming text

```ts
const response = await poe.chat.completions.create({
  model: selectedModelId, // obtained from the live catalogue
  messages: [
    { role: "system", content: "Be concise and factual." },
    { role: "user", content: userMessage },
  ],
  max_tokens: 1024,
});

const reply = response.choices[0]?.message?.content ?? "";
```

### Structured responses

Prefer a Responses-style JSON-schema format when the selected model supports
it. Define a small schema, set strictness where supported, and validate the
decoded value with the app's runtime schema validator before using it. Treat
model output as untrusted input: reject malformed JSON, missing fields, extra
fields where relevant, and values outside business limits. If the selected
model does not support the requested format, either use a documented
provider-supported fallback or return a normalized unsupported-capability
error; do not silently parse arbitrary prose as JSON.

```ts
const response = await poe.responses.create({
  model: selectedModelId,
  instructions: "Return only the requested object.",
  input: userMessage,
  text: {
    format: {
      type: "json_schema",
      name: "answer",
      strict: true,
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  },
});

// Decode and validate response.output_text with the app's schema validator.
```

### Tool calling

Describe tools with a strict JSON schema and expose only an allow-list of
server-owned operations. Validate every argument before execution, authorize
the user again at execution time, enforce a maximum number of tool turns, and
return tool results as data rather than interpolating them into instructions.
Never let a model choose arbitrary URLs, SQL, shell commands, file paths, or
credentials. Log tool name and outcome, not secrets or unrestricted arguments.

Use the model's tool calls as a request for work, not proof that work succeeded:
execute the validated operation, send back a bounded result, and only then
continue the model turn. If the model or endpoint lacks tool support, return a
clear capability error.

### Vision

For vision-capable models, pass a validated MIME type and bounded image as the
provider's supported image input (often a data URL or base64 payload). Keep
decoding and provider calls on the server, limit dimensions/bytes, reject
untrusted remote URLs unless the app has an explicit safe fetch policy, and do
not persist images or prompts unless the user-facing product requires it.
Redact image-derived personal data from telemetry where possible.

## 6. Reliability and cost controls

Apply these controls in the provider abstraction, not independently in every
route:

- **Retries:** Retry only transient network failures, timeouts, selected 5xx
  responses, and provider rate limits. Use a small bounded attempt count,
  exponential backoff, and jitter. Honor `Retry-After` when present. Never
  retry invalid authentication, exhausted quota, invalid requests, or a
  permanently unavailable model.
- **Timeouts and cancellation:** Give every upstream call a deadline. Connect
  request abort/disconnect signals to the provider request and release all
  listeners and timers in cleanup code.
- **Caching:** Cache only deterministic, idempotent results where the product
  permits it. Include model ID, relevant input, tenant/user scope, tool/schema
  version, and prompt version in the key; use a TTL and bounded storage. Do
  not cache private data across users, failed responses, credentials, or
  unbounded prompts. Invalidate when model or prompt behavior changes.
- **Usage telemetry:** Record model, route/use case, latency, status, retry
  count, cache hit, and provider-reported token usage when available. Apply
  retention and access controls, and omit API keys, full prompts, image bytes,
  tool secrets, and unnecessary personal data.
- **Rate limits and backpressure:** Authenticate before expensive work, apply
  per-user/tenant and global limits before calling Poe, bound concurrent
  upstream requests, and return a retryable 429 with safe headers when limits
  are reached. Do not rely on Poe's limit as the app's abuse protection.
- **Normalized errors:** Map provider failures to a small app contract such as
  `unauthorized`, `quota_exhausted`, `rate_limited`, `model_unavailable`,
  `invalid_request`, `upstream_timeout`, and `upstream_error`. Give clients
  a stable code and safe message; keep provider request IDs and stack details
  in protected server logs only.

## 7. Streaming safely over SSE

Streaming is a resource lifecycle, not just a `for await` loop. The route must
stop upstream work when the client disconnects, handle an upstream failure
after headers have been sent, and terminate the HTTP response on every path.
Never write after a response is destroyed, and never send raw provider error
messages to the client.

The following is a portable Express-style pattern. Adapt the provider call to
the app's abstraction when one exists:

```ts
app.post("/chat/stream", async (req, res) => {
  const controller = new AbortController();
  let clientGone = false;
  let sentDone = false;

  const writeEvent = (event: unknown) => {
    if (!clientGone && !res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  const finish = () => {
    if (!sentDone && !clientGone && !res.destroyed && !res.writableEnded) {
      sentDone = true;
      res.write("data: [DONE]\n\n");
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  };
  const onRequestAborted = () => {
    clientGone = true;
    controller.abort();
  };
  const onResponseClose = () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  };

  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClose);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  try {
    // Authenticate, validate req.body, and apply rate limits before this call.
    const stream = await poe.chat.completions.create({
      model: selectedModelId,
      messages: validatedMessages,
      stream: true,
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) writeEvent({ delta });
      if (clientGone) break;
    }
  } catch (error) {
    // Before headers, a normal error response is still possible. After
    // headers, emit a safe SSE error and let finally send [DONE]/end().
    if (!res.headersSent && !clientGone) {
      res.status(normalizePoeError(error).status).json(
        normalizePoeError(error).body,
      );
      return;
    }
    if (!clientGone) writeEvent({ error: normalizePoeError(error).body });
  } finally {
    req.removeListener("aborted", onRequestAborted);
    res.removeListener("close", onResponseClose);
    controller.abort(); // also stops a provider stream that ended normally
    finish();
  }
});
```

In real code, compute the normalized error once rather than calling the
normalizer twice, and make sure the provider SDK accepts the abort signal (or
use its documented cancellation mechanism). If headers are already sent,
preserve the SSE framing and safe error code; do not attempt to change the
status. If a disconnect has already occurred, cleanup silently and do not
write. For non-Express servers, implement the equivalent abort and guaranteed
close behavior.

## 8. Key health-check

Use a server-only health/setup check to validate configuration. A successful
`GET /v1/models` proves that the key can access the catalogue at that moment;
it does not prove that a particular model, capability, quota, or inference
request will succeed.

```ts
type PoeKeyStatus =
  | "valid"
  | "rejected"
  | "quota_exceeded"
  | "rate_limited"
  | "unavailable"
  | "unknown";

async function checkPoeKey(apiKey: string): Promise<PoeKeyStatus> {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.poe.com/v1",
    timeout: 5_000,
  });
  try {
    await client.models.list();
    return "valid";
  } catch (error: unknown) {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403) return "rejected";
      if (error.status === 402) return "quota_exceeded";
      if (error.status === 429) return "rate_limited";
      if (error.status === 500 || error.status === 502 ||
          error.status === 503 || error.status === 504) return "unavailable";
    }
    // A timeout or network outage is not proof that a configured key is bad.
    return "unknown";
  }
}
```

Do not log the key or raw error body. A setup UI can fail closed when a
definitive 401/403 or quota response is returned, but should distinguish an
outage from a rejected key. If the app uses a provider abstraction, call its
health-check and preserve its normalized result instead of constructing a
second client.

## 9. Failure modes

| Scenario | Safe handling |
| --- | --- |
| Missing secret | Fail at server startup or provider initialization with a configuration error; never send the key or secret value to the client. |
| 401/403 | Report `unauthorized` and require server configuration repair; do not retry. |
| 402 or exhausted allowance | Report `quota_exhausted`; do not retry automatically. |
| 429 | Apply bounded backoff for eligible upstream calls, respect `Retry-After`, and expose a stable rate-limit response. |
| Timeout/network/5xx | Abort and retry only within a bounded transient policy; then report `upstream_timeout` or `upstream_error`. |
| Invalid request/schema/tool arguments | Return a 400-class contract error after local validation; do not retry unchanged input. |
| Model unavailable/retired | Refresh the live catalogue and return `model_unavailable`; do not silently substitute a different model unless the product explicitly allows it. |
| Unsupported capability | Return a stable capability error or choose a documented fallback; never pretend structured output, tools, vision, or streaming succeeded. |
| Browser CORS attempt | Keep Poe calls server-side. The browser calls the app's authenticated route, not `api.poe.com`. |
| Client disconnect during stream | Abort upstream work, remove listeners, avoid writes, and close/settle resources. |

## 10. Generic new-route checklist

For every route that calls Poe, check all of the following:

- [ ] An existing provider abstraction was searched for and reused when
      available; no duplicate client or direct provider call was added.
- [ ] Poe is called only from server-side code; the API key and provider
      details cannot reach client bundles or browser logs.
- [ ] Authentication and authorization happen before model work, including
      authorization of each server-side tool operation.
- [ ] Per-user/tenant and global rate limits, concurrency bounds, and request
      deadlines are applied before the upstream call.
- [ ] Request and response contracts are documented in the app's existing
      schema/API mechanism and runtime validation rejects untrusted output.
- [ ] The selected model and requested capabilities come from the live
      catalogue/configuration, with an explicit unsupported-model path.
- [ ] Retries, caching, telemetry, abort handling, and normalized errors use
      shared provider policies rather than route-specific copies.
- [ ] Streaming handles upstream failure, client disconnect, cancellation,
      cleanup, and guaranteed response termination.
- [ ] Unit tests cover validation, auth/rate limits, provider success, each
      relevant normalized failure, cache/telemetry behavior, and stream cleanup.
- [ ] An end-to-end test exercises the authenticated browser-to-route contract
      when the feature is user-visible; provider calls are safely stubbed.
- [ ] Logs and metrics include route/use case, model, latency, status, retries,
      and usage without prompts, images, secrets, or unnecessary PII.
- [ ] The route is tested with missing configuration and provider outages, and
      operational alerts or dashboards have been considered.

## Quick-start checklist

- [ ] Searched for and understood an existing provider/client abstraction.
- [ ] `POE_API_KEY` is in Replit Secrets or is managed by the existing provider.
- [ ] All provider calls stay server-side.
- [ ] Raw SDK fallback uses `https://api.poe.com/v1` and a single server client.
- [ ] The live model catalogue, not a stale hard-coded table, drives selection.
- [ ] Request/output schemas, tools, and vision inputs are validated.
- [ ] Timeouts, bounded retries, cancellation, cache scope, usage telemetry,
      and rate limits are implemented at the provider boundary.
- [ ] Error responses are normalized and safe.
- [ ] Streaming routes terminate on success, failure, and disconnect.
- [ ] Unit and relevant end-to-end coverage is in place.
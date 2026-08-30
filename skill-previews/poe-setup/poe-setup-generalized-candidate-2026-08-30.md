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

# Poe API Integration — Portable, Chatbot-Oriented Setup Guide

Poe exposes an OpenAI-compatible API at `https://api.poe.com/v1`. The endpoint
accepts common OpenAI request shapes, but compatibility does not mean every
model supports every capability or parameter. Discover the live catalogue and
verify the capability metadata and current Poe documentation for the exact
model and endpoint actually selected.

This guide is a provider-specific transport guide behind a provider-neutral
application boundary. The application should choose a capability-appropriate
model through an explicit intake and registry process, then let one server-side
provider adapter perform the Poe call.

## 1. Intake before model selection

Do not choose a model from a familiar name, an old example, or a vague request.
For each chatbot or route, gather these fields in order:

1. **Goal and use case:** What should the user accomplish, and what is success?
2. **Input contract:** Text only, images, audio, files, structured records, or a
   bounded combination? What MIME types, sizes, and trust boundaries apply?
3. **Output contract:** Free text, a schema-validated JSON object, a tool request,
   a streamed response, or another explicitly validated shape?
4. **Required capabilities:** Vision, tools, structured output, reasoning,
   streaming, long context, or multi-turn state. Mark each as required,
   optional, or forbidden.
5. **Context:** What history, retrieved data, system instructions, and tool
   results must be transferred? What may not be retained or sent?
6. **Operational targets:** Maximum latency, token/payload limits, concurrency,
   and whether partial streaming is useful.
7. **Cost target:** Per-request or monthly budget, token ceiling, and whether a
   cheaper documented fallback is acceptable.
8. **Privacy and authorization:** Data classification, retention expectations,
   tenant/user isolation, consent, and which server-owned actions the user may
   authorize.
9. **Fallback expectations:** May the product retry, refresh the catalogue, use
   another registered model, degrade from streaming to non-streaming, or ask the
   user to retry? Define what must instead fail closed.

Record the answers as the route's input/output contract. If a required field is
unknown, ask for it or stop with a clear configuration error; do not infer
permission, privacy suitability, or capability from the model name. Filter the
registry using the required fields, verify live availability, select an exact
model ID, and re-check the selected endpoint's supported parameters immediately
before the call. A fallback is a separately verified registry choice, not an
implicit substitution.

## 2. Choose the integration layer first

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

Only use the raw OpenAI-compatible SDK or REST fallback below when no suitable
abstraction exists, or when the abstraction explicitly delegates client
creation to it. Do not install a second SDK or create a second provider
singleton merely because a route needs a new model capability.

## 3. Maintain a model capability and routing registry

Treat the registry as application configuration with an owner and verification
record, not as a permanent copy of Poe's catalogue. Keep two related records
when useful:

- The **capability registry** says what an exact model/endpoint combination was
  observed and verified to support.
- The **use-case routing record** says which verified entries are eligible for a
  particular use case, in priority order, with explicit fallback behavior.

### Capability registry contract

Every row must use the exact model ID returned by Poe and identify the endpoint
whose behavior was verified. The row must contain at least:

| Field | Required meaning |
| --- | --- |
| Exact identity | `model.id` copied verbatim, provider, endpoint, and any version/revision label supplied by the provider |
| Live availability | Last `GET /v1/models` observation, availability status, and whether a fresh lookup is required before use |
| Verified inputs/outputs | Accepted input modalities and MIME types, output forms, maximum tested payloads, and response extraction path |
| Capabilities | Vision, tools, structured JSON Schema output, reasoning, streaming, multi-turn/state behavior; each is `yes`, `no`, or `unknown` with evidence |
| Limits | Context, input/output tokens, image dimensions/bytes, tool turns, concurrency, timeout, and request-size limits |
| Parameters | Supported optional fields, rejected fields, defaults, and provider-specific constraints; do not copy unsupported fields |
| Cost and latency | Current documented or observed cost basis, budget class, latency target/observations, and date; never a permanent price claim |
| Privacy suitability | Allowed data classification, retention/processing notes, user/tenant restrictions, and authorization requirements |
| REST mapping | `POST /v1/chat/completions`, `POST /v1/responses`, or another currently documented endpoint and its request shape |
| Validation | Request/response schema, output limits, tool-argument validation, and test evidence |
| Reliability | Retry class, timeout, cancellation behavior, rate-limit handling, cache eligibility, and safe normalized errors |
| Fallback | Explicit eligible model/endpoint, allowed degradation, and fail-closed condition |
| Approved use | Named route/use-case classes and prohibited uses |
| Ownership | Registry owner, verification owner, verification date, source links/notes, and next review trigger |

Never turn `unknown` into `yes` because an SDK type or catalogue row has a
similar name. Keep stale rows for audit if needed, but mark them unavailable
until a fresh catalogue lookup and capability check pass.

### Use-case routing record

For each chatbot route, record the intake result, required versus optional
capabilities, privacy class, budget/latency target, primary registry key,
ordered fallbacks, permitted degradation, and the owner who can change routing.
The route must reject a model that is available but does not satisfy a required
capability. Do not use the presence of a model in the catalogue as proof that
inference, vision, tools, structured output, or streaming works for that model.

## 4. Store the API key as a Replit Secret

1. Open the **Secrets** panel in the Replit workspace.
2. Add a secret named **`POE_API_KEY`** and paste the key as its value.
3. Read it only in server-side code as `process.env.POE_API_KEY`.

Never hard-code the key, commit it, include it in a client bundle, put it in
browser local storage, or return it in an error/log response. Do not ask a user
to paste a secret into chat. If the app already uses a secret-management or
provider configuration layer, follow that layer's naming and validation
conventions instead of exposing the key to application code.

## 5. Raw SDK fallback

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

## 6. Discover live model IDs and capabilities

The live `GET https://api.poe.com/v1/models` response is authoritative for the
model IDs currently exposed to the key. Query it server-side for setup and
model-picker workflows and refresh it with a short server-side cache when
appropriate. Use the response as an availability input, not as proof of every
inference capability.

```ts
const response = await fetch("https://api.poe.com/v1/models", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${process.env.POE_API_KEY}`,
    Accept: "application/json",
  },
  signal,
});

if (!response.ok) {
  throw normalizePoeHttpError(response);
}

const body: unknown = await response.json();
const models = parseModelsResponse(body).map((model) => ({
  id: model.id,
}));
```

The standard OpenAI SDK equivalent is:

```ts
const modelsPage = await poe.models.list();
const models = modelsPage.data.map((model) => ({ id: model.id }));
```

Validate the response shape before using it. Send every returned `id` verbatim:
do not normalize case, infer aliases, add a provider prefix, or assume that an
ID from an old example still exists. If the live payload includes extra
capability fields, parse and validate those fields into the app's registry
schema. If it does not, consult current Poe documentation and run the smallest
safe capability probe or configured inference check; an SDK `Model` type and a
catalogue response do not guarantee provider-specific metadata or inference.

Examples must use placeholders such as `<LIVE_MODEL_ID>` and must be labeled
illustrative. Do not put a named model, price, capability, or availability in
production defaults unless the live registry and current documentation have
verified it. A successful catalogue request proves only that the key can access
the catalogue at that moment.

## 7. Use the correct server-side REST endpoint

All Poe calls require server-side Bearer authentication:

```http
Authorization: Bearer <server-side-secret>
Content-Type: application/json
Accept: application/json
```

Never put the Bearer value in browser code, a URL, a client-visible error, a
telemetry field, or a source-controlled example. Authenticate and authorize
the app user before the upstream request. Resolve `<LIVE_MODEL_ID>` from the
live catalogue/registry and verify optional parameters against the selected
model's current capability row and Poe documentation.

### Chat Completions

Use `POST https://api.poe.com/v1/chat/completions` for a chat message sequence
when the selected model and registry row support the requested message content,
parameters, and output form:

```ts
const upstream = await fetch("https://api.poe.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.POE_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    model: "<LIVE_MODEL_ID>",
    messages: [
      { role: "system", content: "Be concise and factual." },
      { role: "user", content: validatedUserMessage },
    ],
    max_tokens: 1024,
  }),
  signal,
});

const payload: unknown = await readPoeJson(upstream);
const reply = parseChatCompletion(payload).choices[0]?.message?.content ?? "";
```

Validate the request locally, reject unsupported optional fields before sending
them, verify the response shape and content limits, and treat the extracted
message as untrusted data. Do not assume every model accepts every Chat
Completions parameter.

### Responses

Use `POST https://api.poe.com/v1/responses` only when the current Poe
documentation and the selected capability row verify that the model supports
the Responses endpoint and the requested input, output, tools, or state shape:

```ts
const upstream = await fetch("https://api.poe.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.POE_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    model: "<LIVE_MODEL_ID>",
    instructions: "Return only the requested answer.",
    input: validatedInput,
    max_output_tokens: 1024,
  }),
  signal,
});

const payload: unknown = await readPoeJson(upstream);
const answer = parseResponse(payload).output_text;
```

Do not infer that a Responses object, response ID, or conversation-like field
creates portable shared state. Store only the application-approved context and
reconstruct it explicitly when needed.

### Structured JSON Schema output

For a model and endpoint whose registry row says structured output is supported,
request a small schema and validate the decoded result with the app's runtime
schema validator:

```ts
const upstream = await fetch("https://api.poe.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.POE_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    model: "<LIVE_MODEL_ID>",
    input: validatedInput,
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
  }),
  signal,
});

const payload: unknown = await readPoeJson(upstream);
const value = answerSchema.parse(parseResponse(payload).output_text);
```

Use the currently documented field name and schema shape for the selected
endpoint; some models or API surfaces may support a different structured-output
form. Reject malformed JSON, missing fields, extra fields where relevant, and
values outside business limits. If structured output is unsupported, use only a
documented fallback or return a normalized unsupported-capability error. Never
silently parse arbitrary prose as JSON.

### Tool calling

Declare only server-owned, allow-listed operations with strict JSON schemas:

```ts
const requestBody = {
  model: "<LIVE_MODEL_ID>",
  input: validatedInput,
  tools: [
    {
      type: "function",
      name: "lookup_record",
      description: "Look up an authorized record by its opaque ID.",
      parameters: {
        type: "object",
        properties: { record_id: { type: "string", maxLength: 128 } },
        required: ["record_id"],
        additionalProperties: false,
      },
    },
  ],
};
```

The exact tool envelope differs by endpoint and must match current Poe
documentation and the registry row. Treat a model tool call as a request for
work, not proof that work succeeded: validate every argument, authorize the
user again at execution time, enforce a maximum number of tool turns, execute
only the allow-listed operation, bound and validate its result, and send the
result back as data before continuing the model turn. If the endpoint/model
lacks tool support, return a clear capability error.

Never let a model choose arbitrary URLs, SQL, shell commands, file paths, or
credentials. Log tool name and outcome, not secrets or unrestricted arguments.

### Multimodal input

For a vision-capable model, validate MIME type, dimensions, byte size, and
content before creating the provider-specific image input. For Chat
Completions, the documented shape may resemble:

```ts
{
  role: "user",
  content: [
    { type: "text", text: validatedPrompt },
    {
      type: "image_url",
      image_url: { url: validatedDataUrl },
    },
  ],
}
```

Use the exact current shape for the selected endpoint; do not assume that an
image field accepted by one API surface is accepted by another. Keep decoding
and provider calls on the server, limit dimensions/bytes, reject untrusted
remote URLs unless the app has an explicit safe fetch policy, and do not
persist images or prompts unless the user-facing product requires it. Redact
image-derived personal data from telemetry where possible.

### Streaming and SSE

Set `stream: true` only when the capability row and current documentation
confirm streaming for the selected endpoint/model. For an SSE response, parse
complete `data:` events, tolerate provider event variants, validate each
increment before forwarding, and never pass raw provider errors to the client.
The provider's terminal event and the app's terminal event are separate
contracts; emit the app's documented `[DONE]` marker only after cleanup has
started and the response can be closed safely.

The portable Express-style lifecycle pattern is:

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
    // Authenticate, validate req.body, check the registry, and apply
    // rate limits before this call.
    const streamResponse = await fetch(
      "https://api.poe.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.POE_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: "<LIVE_MODEL_ID>",
          messages: validatedMessages,
          stream: true,
        }),
        signal: controller.signal,
      },
    );
    if (!streamResponse.ok || !streamResponse.body) {
      throw normalizePoeHttpError(streamResponse);
    }

    for await (const event of parseSse(streamResponse.body)) {
      if (clientGone) break;
      const safeEvent = parseAndValidatePoeStreamEvent(event);
      if (safeEvent.delta) writeEvent({ delta: safeEvent.delta });
    }
  } catch (error) {
    const normalized = normalizePoeError(error);
    if (!res.headersSent && !clientGone) {
      res.status(normalized.status).json(normalized.body);
      return;
    }
    if (!clientGone) writeEvent({ error: normalized.body });
  } finally {
    req.removeListener("aborted", onRequestAborted);
    res.removeListener("close", onResponseClose);
    controller.abort();
    finish();
  }
});
```

In real code, `parseSse`, response validators, and error normalizers must
handle buffering, event boundaries, provider event variants, and safe limits.
If headers are already sent, preserve SSE framing and the safe error code; do
not attempt to change the status. If a disconnect has occurred, cleanup
silently and do not write. For non-Express servers, implement equivalent abort,
listener cleanup, and guaranteed close behavior.

## 8. Reconstruct context when switching models

Models do not share hidden memory, provider conversation state, or portable
response state unless the current endpoint explicitly documents such behavior
and the application has chosen to use it. Never pass an opaque response ID or
assume one model can dereference another model's state.

When routing or falling back to another model:

1. Stop the old attempt or mark it cancelled; do not let late output overwrite
   the new result.
2. Rebuild a bounded context package from application-owned state: system
   instructions, relevant user turns, validated assistant output, retrieved
   facts with provenance, and approved tool results.
3. Re-apply the destination model's input, privacy, token, and capability
   constraints. Convert content explicitly rather than silently dropping
   images, tools, schema requirements, or citations.
4. Identify the destination model and context transfer in telemetry without
   recording secrets or unnecessary prompt contents.
5. Validate the destination response against the same user-facing contract,
   or apply an explicitly documented degraded contract and tell the caller.

Do not copy untrusted model text into system instructions, tool authorization,
or SQL/shell/file arguments. Context reconstruction is a data boundary and
must be treated as untrusted-input processing.

## 9. Reliability, privacy, and cost controls

Apply these controls in the provider abstraction, not independently in every
route:

- **Retries:** Retry only transient network failures, timeouts, selected 5xx
  responses, and provider rate limits. Use a small bounded attempt count,
  exponential backoff, and jitter. Honor `Retry-After` when present. Never
  retry invalid authentication, exhausted quota, invalid requests, or a
  permanently unavailable model. A retry must reuse a safe idempotency policy
  and must not duplicate an irreversible tool operation.
- **Timeouts and cancellation:** Give every upstream call a deadline. Connect
  request abort/disconnect signals to the provider request and release all
  listeners and timers in cleanup code. Abort stale attempts when routing
  switches models.
- **Caching:** Cache only deterministic, idempotent results where the product
  permits it. Include exact model ID, endpoint, relevant input, tenant/user
  scope, tool/schema version, context and prompt version, and capability mode
  in the key; use a TTL and bounded storage. Do not cache private data across
  users, failed responses, credentials, or unbounded prompts. Invalidate when
  model or prompt behavior changes.
- **Usage telemetry:** Record model, endpoint, route/use case, latency, status,
  retry count, cache hit, fallback transition, and provider-reported token
  usage when available. Apply retention and access controls, and omit API keys,
  full prompts, image bytes, tool secrets, and unnecessary personal data.
- **Rate limits and backpressure:** Authenticate before expensive work, apply
  per-user/tenant and global limits before calling Poe, bound concurrent
  upstream requests, and return a retryable 429 with safe headers when limits
  are reached. Do not rely on Poe's limit as the app's abuse protection.
- **Output validation:** Validate every non-streaming response, structured
  object, tool argument/result, multimodal extraction, and stream event against
  the app's runtime contract before use or forwarding. Bound output size and
  tool turns.
- **Privacy:** Route only data permitted by the intake's privacy class. Do not
  persist prompts, images, or model output beyond the product's stated need.
  Separate tenants/users in storage, cache keys, logs, and authorization.
- **Normalized errors:** Map provider failures to a small app contract such as
  `unauthorized`, `quota_exhausted`, `rate_limited`, `model_unavailable`,
  `unsupported_capability`, `invalid_request`, `upstream_timeout`, and
  `upstream_error`. Give clients a stable code and safe message; keep provider
  request IDs and stack details in protected server logs only.

## 10. Key health-check

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

## 11. Failure modes and explicit fallback

| Scenario | Safe handling |
| --- | --- |
| Missing secret | Fail at server startup or provider initialization with a configuration error; never send the key or secret value to the client. |
| 401/403 | Report `unauthorized` and require server configuration repair; do not retry. |
| 402 or exhausted allowance | Report `quota_exhausted`; do not retry automatically. |
| 429 | Apply bounded backoff for eligible upstream calls, respect `Retry-After`, and expose a stable rate-limit response. |
| Timeout/network/5xx | Abort and retry only within a bounded transient policy; then report `upstream_timeout` or `upstream_error`. |
| Invalid request/schema/tool arguments | Return a 400-class contract error after local validation; do not retry unchanged input. |
| Model unavailable/retired | Refresh the live catalogue and return `model_unavailable`; do not silently substitute a different model unless the route's routing record explicitly allows the verified fallback. |
| Unsupported capability/parameter/endpoint | Return `unsupported_capability` or choose the documented verified fallback; never pretend structured output, tools, vision, Responses, or streaming succeeded. |
| Catalogue succeeds but inference fails | Keep the key/catalogue status separate from model capability or quota status; normalize the inference failure and update the registry evidence if appropriate. |
| Browser CORS attempt | Keep Poe calls server-side. The browser calls the app's authenticated route, not `api.poe.com`. |
| Client disconnect during stream | Abort upstream work, remove listeners, avoid writes, and close/settle resources. |
| Model switch during a request | Cancel the stale attempt, reconstruct context explicitly, and prevent late output from winning. |

A fallback must be selected from a live-available, capability-verified registry
row and must satisfy the intake's privacy and output contract. If no such row
exists, fail clearly rather than silently changing the user's requested
behavior.

## 12. Generic new-route checklist

For every route that calls Poe, check all of the following:

- [ ] Intake records goal, input, output, required capabilities, context,
      latency, cost, privacy, authorization, and fallback expectations.
- [ ] An existing provider abstraction was searched for and reused when
      available; no duplicate client or direct provider call was added.
- [ ] Poe is called only from server-side code; the API key and provider
      details cannot reach client bundles or browser logs.
- [ ] Authentication and authorization happen before model work, including
      authorization of each server-side tool operation.
- [ ] Per-user/tenant and global rate limits, concurrency bounds, and request
      deadlines are applied before the upstream call.
- [ ] The exact model ID came from a live catalogue lookup and the capability
      registry identifies the endpoint, verified parameters, limits, cost,
      privacy suitability, fallback, verification date, and owner.
- [ ] `GET /v1/models` availability is not being treated as proof of inference
      or optional capability support.
- [ ] Chat Completions versus Responses was selected from current endpoint and
      model support; unsupported optional fields are rejected before sending.
- [ ] Request and response contracts are documented in the app's existing
      schema/API mechanism and runtime validation rejects untrusted output.
- [ ] Context is rebuilt explicitly when switching models; no shared hidden
      memory or portable response state is assumed.
- [ ] Retries, caching, telemetry, abort handling, and normalized errors use
      shared provider policies rather than route-specific copies.
- [ ] Streaming handles SSE parsing, upstream failure, client disconnect,
      cancellation, cleanup, and guaranteed response termination.
- [ ] Unit tests cover validation, auth/rate limits, model discovery, endpoint
      selection, provider success, each relevant normalized failure,
      cache/telemetry behavior, context reconstruction, and stream cleanup.
- [ ] An end-to-end test exercises the authenticated browser-to-route contract
      when the feature is user-visible; provider calls are safely stubbed.
- [ ] Logs and metrics include route/use case, model, endpoint, latency, status,
      retries, fallback, and usage without prompts, images, secrets, or
      unnecessary PII.
- [ ] The route is tested with missing configuration and provider outages, and
      operational alerts or dashboards have been considered.

## Quick-start checklist

- [ ] Completed the intake before selecting a model or endpoint.
- [ ] Searched for and understood an existing provider/client abstraction.
- [ ] `POE_API_KEY` is in Replit Secrets or is managed by the existing provider.
- [ ] All provider calls stay server-side and use Bearer authentication.
- [ ] Raw SDK fallback uses `https://api.poe.com/v1` and a single server client.
- [ ] `GET /v1/models` supplies exact IDs; no stale example is a production
      default, and catalogue access is not treated as inference proof.
- [ ] The selected registry row verifies endpoint, inputs, outputs, capabilities,
      limits, parameters, cost, privacy, validation, fallback, and ownership.
- [ ] Chat Completions versus Responses is supported by the live/current
      endpoint documentation for the exact model.
- [ ] Request/output schemas, tools, and vision inputs are validated.
- [ ] Model switches reconstruct approved context explicitly.
- [ ] Timeouts, bounded retries, cancellation, cache scope, usage telemetry,
      privacy controls, and rate limits are implemented at the provider boundary.
- [ ] Error responses are normalized and safe.
- [ ] Streaming routes parse SSE and terminate on success, failure, and
      disconnect.
- [ ] Unit and relevant end-to-end coverage is in place.

---

# Skill Compression Preview Package

## Candidate identity and baseline

- **Candidate label:** `P3 — Complete candidate`
- **Candidate ID:** `poe-setup-generalized-candidate-2026-08-30`
- **Canonical source:** `.agents/skills/poe-setup/SKILL.md`
- **Baseline label:** `B0 — Baseline`
- **Baseline identity:** SHA-256
  `6ed166a1ec8e22847d85875227c0a80169d8ce291a9c686c11d01f4c95655e42`
- **Baseline capture:** Complete canonical source, including frontmatter and
  instructional text, read before revision on 2026-08-30.
- **Preview path:** `skill-previews/poe-setup/poe-setup-generalized-candidate-2026-08-30.md`

The frontmatter is reproduced byte-for-byte in the candidate. The baseline
source and every candidate were compared by content and meaning; the
authoritative source was not edited.

## Invariant Ledger

| Ledger area | B0 invariant and candidate coverage | Status |
| --- | --- | --- |
| Triggers | The name is Poe-Setup; trigger description covers Poe models, OpenAI-compatible clients, structured output, tools, vision, streaming, provider wrappers, secrets, discovery, resilient routes, and portable tests. | Explicit; frontmatter retained unchanged |
| Requirements | Integrate Poe behind an existing abstraction; use live IDs; keep calls server-side; validate requests/outputs; support safe capabilities and resilient routes. | Explicit; retained and expanded |
| Workflow steps | Inspect abstraction, configure secret, use one client, discover models, select supported endpoint/capabilities, implement reliability/health/checklists. | Explicit; intake and registry precede selection |
| Safety and authorization boundaries | No client key, no browser Poe calls, no secret logs, auth before work, tool allow-list and reauthorization, bounded multimodal input, privacy-safe telemetry. | Explicit; retained and made executable |
| Inputs | User messages, multimodal data, schemas, tool arguments, model IDs, API key, endpoint capabilities. | Explicit; validates MIME, size, schema, exact IDs |
| Outputs | Provider calls, validated text/JSON/tools/streams, normalized errors, health status, route checklist. | Explicit; endpoint-specific response and SSE handling added |
| Exceptions | Missing secret, auth/quota/rate-limit, timeout/network/5xx, invalid input, unavailable model, unsupported capability, disconnect. | Explicit; catalogue success versus inference proof separated |
| Escalation rules | Ask or stop when intake is incomplete; refresh/verify before fallback; fail closed when no verified fallback exists; explicit approval before source application. | Explicit |
| Tool and file constraints | Canonical skill is protected; default is preview; no mirror edits; candidate must be durable and outside `.local`; only approved scope may later be applied. | Explicit in this package; source/mirrors unchanged |
| Identity and metadata | `name` and description remain unchanged; target-specific Poe terms remain where required. | Explicit; protected |

## Required compression workflow record

The following record distinguishes exploratory rounds from ordered compression
passes. Each result was compared with `B0` and the immediately preceding
candidate. The strongest wording was retained whenever a shorter alternative
weakened an invariant.

### Brainstorm-and-iterate Round 1 — safe opportunities

**Input:** `B0 — Baseline` and the invariant ledger.

**Ideas considered:** add a chatbot intake contract; separate capability
registry from use-case routing; provide raw REST discovery and endpoint
examples; use placeholder model IDs; state catalogue availability is not
inference proof; make cross-model context transfer explicit; preserve existing
reliability, security, health, failure, and checklist guidance.

**Applied to produce `C1`:** Add the intake, registry, REST, context-transfer,
and explicit fallback concepts while retaining the baseline's abstraction,
secret, validation, reliability, health, failure, and checklist content.

**Rejected:** Replace the skill with a short “use an OpenAI client” recipe.
That would lose trigger coverage, server-only boundaries, capability checks,
stream cleanup, normalized errors, and the route checklist. Also rejected:
hard-coded model rows, because availability and prices are time-sensitive.

### Brainstorm-and-iterate Round 2 — challenge and iterate

**Input:** `C1`, `B0`, and the ledger.

**Challenge findings:** A catalogue-only selection path could be mistaken for
capability proof; SDK examples could hide REST endpoint choice; a generic
“switch models” instruction could lose tool/schema/privacy context; a broad
streaming example could omit SSE framing and disconnect cleanup.

**Applied to produce `C2`:** Add explicit live `GET /v1/models` Bearer REST
discovery, exact-ID preservation, endpoint-by-endpoint checks, registry fields
for limits/parameters/ownership, explicit context reconstruction steps, and
SSE parsing/cleanup requirements. Keep the baseline health distinction and
failure handling.

**Rejected:** Treat a single successful capability probe as permanent truth.
The registry must carry verification date/owner and refresh triggers; the live
catalogue and current documentation remain authoritative. Rejected:
automatically dropping from structured output/tools/vision to plain text,
because that changes the output or safety contract without consent.

### Pass 1 — remove redundancy

**Input:** `C2`; compared with `B0` and `C2`.

**Result:** `P1` retained the strongest candidate while consolidating repeated
warnings into the intake, registry, endpoint, reliability, and fallback
boundaries. Baseline sections were kept where they carry distinct operational
guidance; duplicate model-name warnings were combined into the exact-ID and
placeholder rules.

**Rejected shorter alternative:** One universal “validate everything and retry
carefully” paragraph. It obscured the distinct rules for tool authorization,
output validation, retry eligibility, cancellation, privacy, and safe errors.

### Pass 2 — clarify decision boundaries

**Input:** `P1`; compared with `B0` and `P1`.

**Result:** `P2` made “catalogue availability versus inference/capability”
explicit, separated Chat Completions and Responses selection, required
parameter verification before optional fields, defined when a fallback is
allowed, and made model-switch context reconstruction a numbered procedure.
It also clarified before-headers versus after-headers SSE behavior.

**Rejected shorter alternative:** “Use the best supported endpoint.” It leaves
the endpoint, model, parameter, and fallback decision to inference and does
not protect against an available model lacking a requested feature.

### Pass 3 — polish language and ordering

**Input:** `P2`; compared with `B0` and `P2`.

**Result:** `P3 — Complete candidate` improves scanability by placing intake,
integration, registry, secret setup, discovery, REST endpoint examples,
context, operations, health, failure modes, and checklists in execution order.
It uses parallel registry/checklist language and provider-neutral placeholders.
No frontmatter, trigger metadata, protected boundary, or required exception was
weakened.

**Rejected shorter alternative:** Remove the repeated quick-start checklist as
duplicative. It is a distinct executable handoff for implementers and preserves
the baseline's expected completion surface; it was retained with concise
cross-references rather than deleted.

## Diff summary

### Meaningful changes from `B0`

- Added a pre-selection chatbot intake sequence covering goal, input, output,
  capability, context, latency, cost, privacy, authorization, and fallback.
- Added separate capability-registry and use-case-routing contracts with exact
  identity, availability, inputs/outputs, capabilities, limits, parameters,
  cost/latency, privacy, REST mapping, validation, reliability, fallback,
  approved use, date, and ownership.
- Added direct server-side `GET /v1/models` discovery with Bearer auth,
  response validation, exact-ID preservation, and the distinction between
  catalogue access and inference/capability proof.
- Added server-side REST guidance for Chat Completions, Responses, JSON Schema
  output, tools, multimodal inputs, and SSE streaming, all using
  `<LIVE_MODEL_ID>` placeholders and current-documentation checks.
- Added explicit context reconstruction and stale-attempt cancellation when
  switching models.
- Expanded operational rules to make output validation, privacy, fallback
  eligibility, endpoint-aware caching, and model-switch telemetry observable.
- Added model/endpoint selection and intake checks to the route and quick-start
  checklists.

### Protected content and out-of-scope content unchanged

- Frontmatter name, trigger description, and YAML structure are unchanged.
- Existing provider abstraction guidance, Replit Secret instructions,
  raw-SDK fallback, health-check classification, failure table concepts,
  streaming lifecycle, retry/caching/telemetry/rate-limit rules, and route
  checklist requirements remain present.
- `.agents/skills/poe-setup/SKILL.md`, `.local/custom_skills/`, other runtime
  mirrors, scripts, dependencies, routes, secrets, and application code were
  not edited.

## Adversarial acceptance checks

| Check | Scenario and ledger entries | Result |
| --- | --- | --- |
| Concise target | Implementer reads only the quick-start checklist and must still discover exact IDs, verify endpoint support, keep calls server-side, validate output, handle cancellation, and test. Requirements, outputs, tool/file constraints retained. | Pass; checklist includes each boundary and points to the full procedure |
| Safety-sensitive target | User asks the chatbot to use a tool with an arbitrary URL or to expose the Poe key. Safety/authorization, inputs, exceptions. | Pass; server-only key handling, allow-listed tools, argument validation, reauthorization, and refusal of arbitrary URLs/credentials are explicit |
| Procedural target | New route must choose Chat Completions versus Responses, select a live model, and fall back. Workflow, requirements, escalation. | Pass; ordered intake → registry filter → live lookup → endpoint/parameter check → call → validation → explicit fallback |
| Exception-heavy target | Key is valid for `/v1/models`, but inference rejects structured output; client disconnects during SSE. Exceptions, outputs, cancellation. | Pass; catalogue status is separated from capability status; unsupported capability is normalized; stream aborts, removes listeners, avoids writes, and closes |
| Contradictory target | A stale example suggests a named model or capability while the live catalogue/registry disagrees. Identity, inputs, tool/file constraints. | Pass; placeholders are used, live catalogue and current docs are authoritative, exact IDs are preserved, stale rows are unavailable |
| Domain-specific target | Implementer needs JSON Schema, tool calls, vision input, and SSE rather than generic “AI” advice. Requirements, domain terms, outputs. | Pass; endpoint-specific terms and examples remain; they are not generalized away |

## Final Review A — semantic fidelity

**Result: Pass.** The candidate retains the exact frontmatter and every
applicable B0 ledger invariant. It preserves server-side secret handling,
provider abstraction, live discovery, exact IDs, validation, retry/caching/
telemetry/rate-limit rules, streaming cleanup, health distinction, normalized
failures, and both checklists. Additions are additive or clarify boundaries.
No shorter alternative was allowed to remove a safety, exception, escalation,
file, or tool constraint.

## Final Review B — general language

**Result: Pass.** The candidate is suitable for a chatbot or application agent
working across JavaScript/TypeScript architectures while retaining Poe-specific
REST endpoints and Replit Secret handling required for correct execution.
Examples use placeholders rather than permanent model claims. Necessary terms
such as SSE, JSON Schema, Bearer authentication, Chat Completions, Responses,
and tool authorization remain because replacing them with generic wording would
reduce precision.

## Change list

### Accepted changes

- Added executable intake and routing gates before model choice.
- Added durable capability and routing registry contracts with verification
  ownership and freshness.
- Added direct Poe REST discovery and exact model-ID rules.
- Added endpoint-aware Chat Completions, Responses, structured-output, tools,
  multimodal, and streaming guidance.
- Added explicit context reconstruction and safe fallback boundaries.
- Reordered the candidate into an implementer-oriented flow while preserving
  baseline operational sections.

### Materially shorter rejected alternatives

- A single SDK-only setup recipe was rejected because it hides endpoint support,
  live IDs, transport behavior, and safety boundaries.
- A hard-coded model/cost/capability table was rejected because it makes stale
  availability claims.
- A single universal retry/validation paragraph was rejected because it obscures
  tool authorization, output validation, cancellation, privacy, and retry
  eligibility.
- Automatic capability degradation was rejected because it changes the user's
  contract without an explicit routing decision.
- Removing the quick-start checklist was rejected because it removes a distinct
  executable handoff.

### Retained wording

- Existing frontmatter and trigger metadata were retained exactly.
- Existing provider abstraction, Replit Secret, raw SDK, health, failure, and
  route-checklist guidance was retained because it is required baseline behavior.
- Explicit server-only, no-secret-logging, no-browser-call, validation, retry,
  cancellation, telemetry, and rate-limit language was retained because
  compression would make its boundaries less observable.
- Poe endpoint names and capability terms were retained because they are
  necessary domain vocabulary.

### Unresolved wording and findings

- Poe may evolve endpoint, parameter, capability, and model behavior; current
  Poe documentation and a fresh live lookup remain required at implementation
  time. No permanent model, price, or availability claim is made.
- The exact tool envelope and structured-output support can differ by endpoint
  and model; the candidate deliberately requires registry/documentation
  verification instead of asserting universal support.
- A future apply task must recheck the canonical source against this B0 hash;
  if it changed, regenerate the preview rather than merging blindly.

### Scope and source status

- **Authoritative source used:** `.agents/skills/poe-setup/SKILL.md`
- **Scope applied:** preview-only instructional-text candidate plus this review
  package; frontmatter was reproduced for review but not changed.
- **Unchanged:** canonical skill, `.local/custom_skills/`, runtime/generated
  mirrors, referenced resources, executable scripts, dependencies, routes,
  secrets, and application behavior.

## Approval gate and apply handoff

Recommendation: **Apply**, only after explicit user approval of the exact
candidate label and path. All required ledger, workflow, adversarial, semantic,
general-language, path, and read-back checks pass in this package. This is not
approval and this preview does not modify the canonical skill.

Ready-to-use follow-up apply task:

> Apply `P3 — Complete candidate` from
> `skill-previews/poe-setup/poe-setup-generalized-candidate-2026-08-30.md` to
> `.agents/skills/poe-setup/SKILL.md` only after the user explicitly names and
> approves that candidate. Before writing, recalculate the canonical source
> identity and require it to equal B0 SHA-256
> `6ed166a1ec8e22847d85875227c0a80169d8ce291a9c686c11d01f4c95655e42`.
> If it differs, stop and regenerate a candidate from a new immutable baseline.
> Preserve frontmatter and all out-of-scope resources, scripts, and mirrors.
> After writing, read back the canonical source, verify the approved
> instructional text exactly, and report any mismatch without trying another
> target.

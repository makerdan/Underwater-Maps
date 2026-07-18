---
name: Poe-Setup
description: >
  Self-contained guide for integrating the Poe API into any JS/TS Replit app.
  Covers secret setup, client instantiation, model catalogue, chat completions
  (streaming + non-streaming), key health-check, and all known gotchas.
  No knowledge of any existing app internals required.
---

# Poe API Integration — Portable Setup Guide

Poe exposes an **OpenAI-compatible** REST API at `https://api.poe.com/v1`.
Any app that can talk to the OpenAI API can talk to Poe with a one-line base URL swap.

---

## 1. Store Your API Key as a Replit Secret

1. Open the **Secrets** panel in your Replit workspace (the lock icon in the left sidebar, or press `F1` → "Secrets").
2. Add a secret named **`POE_API_KEY`** and paste your key as the value.
3. In your server code, read it as `process.env.POE_API_KEY`.

> **Never hard-code the key or commit it to source.** Replit Secrets are injected as environment variables at runtime and are never exposed in the repository.

---

## 2. Install the OpenAI SDK

Poe's API is OpenAI-compatible, so use the standard OpenAI Node SDK:

```bash
npm install openai
# or
pnpm add openai
```

---

## 3. Instantiate the Client

```ts
import OpenAI from "openai";

const poe = new OpenAI({
  apiKey: process.env.POE_API_KEY ?? "",
  baseURL: "https://api.poe.com/v1",
});
```

That's the entire setup. All standard OpenAI SDK methods (`chat.completions.create`, `models.list`, etc.) work against this client.

---

## 4. Model Catalogue

> **Critical**: Poe model IDs are **PascalCase** — `Claude-Sonnet-4.6`, not `claude-sonnet-4-6`.
> Sending the wrong case returns a **404** from Poe. Pass model IDs verbatim from this table.

| Model ID (send verbatim) | Underlying model            | Context window | Notes                        |
| ------------------------ | --------------------------- | -------------- | ---------------------------- |
| `Claude-Sonnet-4.6`      | Anthropic Claude Sonnet 4.6 | ~200 K tokens  | Best balance of speed/quality |
| `Claude-Opus-4.7`        | Anthropic Claude Opus 4.7   | ~200 K tokens  | Highest-quality Poe option   |
| `GPT-4o`                 | OpenAI GPT-4o               | 128 K tokens   | PascalCase — differs from OpenAI's `gpt-4o` |
| `Gemini-3.1-Pro`         | Google Gemini 3.1 Pro       | ~1 M tokens    | PascalCase required          |

All models support streaming. Check `GET /v1/models` (see §6) for the live list — Poe adds new models over time.

---

## 5. Chat Completions

### Non-streaming

```ts
const response = await poe.chat.completions.create({
  model: "Claude-Sonnet-4.6",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2 + 2?" },
  ],
  max_tokens: 1024,
});

const reply = response.choices[0].message.content;
console.log(reply);
```

### Streaming (SSE)

```ts
const stream = await poe.chat.completions.create({
  model: "Claude-Sonnet-4.6",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Write a haiku about the ocean." },
  ],
  stream: true,
  max_tokens: 256,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? "";
  process.stdout.write(delta);
}
console.log();
```

For an Express route that streams to the browser:

```ts
app.post("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await poe.chat.completions.create({
    model: "Claude-Sonnet-4.6",
    messages: req.body.messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
});
```

---

## 6. Key Health-Check

Probe `GET /v1/models` before storing or using a key. A 200 response means the key is valid; anything else means it should be rejected or flagged.

```ts
type PoeKeyStatus = "valid" | "rejected" | "quota_exceeded" | "unknown";

async function checkPoeKey(apiKey: string): Promise<PoeKeyStatus> {
  const client = new OpenAI({ apiKey, baseURL: "https://api.poe.com/v1" });
  try {
    await client.models.list();
    return "valid";
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401 || err.status === 403) return "rejected";
      if (err.status === 402) return "quota_exceeded";
    }
    // Network error, timeout, or unexpected status — fail open so a valid
    // key isn't rejected during a Poe outage.
    return "unknown";
  }
}
```

**Fail-open rule**: return `"unknown"` (not an error) on network errors or timeouts. A genuinely bad key will surface as a 401/403 at inference time; blocking a valid key during an outage is worse than accepting an unverified one.

---

## 7. Gotchas & Failure Modes

| Scenario | Symptom | Fix |
| --- | --- | --- |
| **Wrong model case** | Poe returns 404 | Use exact PascalCase IDs from the table above (e.g. `Claude-Sonnet-4.6`, not `claude-sonnet-4-6`) |
| **Invalid API key** | HTTP 401 or 403 | Re-check the key in your Poe account and update the `POE_API_KEY` secret |
| **Quota exceeded** | HTTP 402 Payment Required | Upgrade your Poe subscription or wait for the quota to reset |
| **Key not set** | `apiKey` is empty string, Poe returns 401 | Ensure `POE_API_KEY` is set in Replit Secrets and the workflow has been restarted since adding it |
| **CORS errors in the browser** | `fetch` to `api.poe.com` blocked | Call Poe only from your **server** (Express/Node), not from client-side browser code — Poe's API does not allow direct browser calls |
| **Streaming hangs** | Response never ends | Ensure your Express response calls `res.end()` after the stream loop, or use `try/finally` to guarantee it |
| **Model not found** | 404 despite correct casing | The model may have been retired — call `GET /v1/models` to get the current live list |

---

## 8. Listing Available Models Dynamically

```ts
const modelsPage = await poe.models.list();
const modelIds = modelsPage.data.map((m) => m.id);
console.log(modelIds);
// e.g. ["Claude-Sonnet-4.6", "Claude-Opus-4.7", "GPT-4o", "Gemini-3.1-Pro", ...]
```

Use this to keep your model selector up to date without hard-coding the catalogue.

---

## Quick-Start Checklist

- [ ] `POE_API_KEY` added to Replit Secrets
- [ ] `openai` package installed
- [ ] Client pointed at `baseURL: "https://api.poe.com/v1"`
- [ ] Model IDs are PascalCase
- [ ] All Poe API calls made server-side (not from the browser)
- [ ] Health-check implemented with fail-open on network errors

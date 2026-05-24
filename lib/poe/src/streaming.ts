import { getPoeClient } from "./client.js";
import type { PoeCompleteParams } from "./types.js";

export async function* poeStream(
  params: Omit<PoeCompleteParams, "stream">,
): AsyncGenerator<string> {
  const client = getPoeClient();

  const stream = await client.chat.completions.create({
    model: params.model,
    messages: params.messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    stop: params.stop,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

export async function poeStreamToString(
  params: Omit<PoeCompleteParams, "stream">,
): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of poeStream(params)) {
    parts.push(chunk);
  }
  return parts.join("");
}

export async function pipeStreamToResponse(
  params: Omit<PoeCompleteParams, "stream">,
  res: {
    write: (data: string) => void;
    end: () => void;
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    for await (const chunk of poeStream(params)) {
      res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
    }
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

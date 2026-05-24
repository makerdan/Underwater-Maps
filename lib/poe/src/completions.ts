import { getPoeClient } from "./client.js";
import type { PoeCompleteParams, PoeCompleteResult, ToolCall } from "./types.js";

export async function poeComplete(params: PoeCompleteParams): Promise<PoeCompleteResult> {
  const client = getPoeClient();

  const response = await client.chat.completions.create({
    model: params.model,
    messages: params.messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    tools: params.tools as Parameters<typeof client.chat.completions.create>[0]["tools"],
    tool_choice: params.toolChoice as Parameters<typeof client.chat.completions.create>[0]["tool_choice"],
    stream: false,
    stop: params.stop,
  });

  const message = response.choices[0]?.message;
  if (!message) {
    throw new Error("Poe API returned no choices");
  }

  const toolCalls: ToolCall[] = [];
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      toolCalls.push({ name: tc.function.name, args, id: tc.id });
    }
  }

  const text = typeof message.content === "string" ? message.content.trim() : null;

  return { text, toolCalls, rawMessage: message };
}

export async function poeCompleteText(params: PoeCompleteParams): Promise<string> {
  const result = await poeComplete(params);
  return result.text ?? "";
}

import OpenAI from "openai";

const POE_BASE_URL = "https://api.poe.com/v1";

function createPoeClient(): OpenAI {
  const apiKey = process.env["POE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "POE_API_KEY environment variable is not set. " +
      "Generate an API key at https://poe.com/api/keys and add it as a secret.",
    );
  }
  return new OpenAI({ apiKey, baseURL: POE_BASE_URL });
}

let _client: OpenAI | null = null;

export function getPoeClient(): OpenAI {
  if (!_client) {
    _client = createPoeClient();
  }
  return _client;
}

export function resetPoeClient(): void {
  _client = null;
}

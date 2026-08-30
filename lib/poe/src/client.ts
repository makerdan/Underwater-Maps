import OpenAI from "openai";
import {
  fetchPoeModelIds,
  POE_ROUTE_REGISTRY,
  selectPoeRoute,
  validatePoeRouteRequest,
  type PoeEndpoint,
  type PoeRouteKey,
} from "./models.js";
import { PoeCapabilityError, PoeModelUnavailableError } from "./errors.js";

const POE_BASE_URL = "https://api.poe.com/v1";
const POE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const POE_MODEL_LOOKUP_TIMEOUT_MS = 10_000;

let modelAvailabilityCache: { ids: readonly string[]; expiresAt: number } | null = null;
let modelAvailabilityRequest: Promise<readonly string[]> | null = null;

export function __resetPoeModelAvailabilityCacheForTests(): void {
  modelAvailabilityCache = null;
  modelAvailabilityRequest = null;
}

async function getLiveModelIds(): Promise<readonly string[]> {
  if (modelAvailabilityCache && Date.now() < modelAvailabilityCache.expiresAt) {
    return modelAvailabilityCache.ids;
  }
  if (!modelAvailabilityRequest) {
    modelAvailabilityRequest = fetchPoeModelIds(fetch, {
      signal: AbortSignal.timeout(POE_MODEL_LOOKUP_TIMEOUT_MS),
    }).then((ids) => {
      modelAvailabilityCache = { ids, expiresAt: Date.now() + POE_MODEL_CACHE_TTL_MS };
      return ids;
    }).finally(() => {
      modelAvailabilityRequest = null;
    });
  }
  return modelAvailabilityRequest;
}

function inferRoute(endpoint: PoeEndpoint, modelId: string, body: Record<string, unknown>): PoeRouteKey {
  if (endpoint === "responses" && body["output_format"] !== undefined) return "classify";
  if (endpoint === "responses" && body["tools"] !== undefined) return "query";
  if (
    endpoint === "responses" &&
    Array.isArray(body["input"]) &&
    body["input"].some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: unknown }).type === "input_image",
    )
  ) {
    return "classify";
  }
  if (endpoint === "responses" && modelId === POE_ROUTE_REGISTRY.query.modelId) return "query";
  if (endpoint === "chat.completions" && modelId === POE_ROUTE_REGISTRY.upscale.modelId) return "upscale";
  if (endpoint === "chat.completions") return "help";
  throw new PoeModelUnavailableError(
    `No verified registry entry exists for model "${modelId}" on ${endpoint}`,
  );
}

async function validatePoeRequest(endpoint: PoeEndpoint, body: Record<string, unknown>): Promise<void> {
  const modelId = body["model"];
  if (typeof modelId !== "string") throw new PoeCapabilityError("Poe request model must be a string");
  const route = inferRoute(endpoint, modelId, body);
  const entry = validatePoeRouteRequest({
    route,
    endpoint,
    modelId,
    parameters: Object.keys(body),
    requiredCapabilities: [
      ...(body["tools"] !== undefined ? ["tools" as const] : []),
      ...(body["output_format"] !== undefined ? ["structuredOutput" as const] : []),
      ...(Array.isArray(body["input"]) && body["input"].some((item) => typeof item === "object" && item !== null && (item as { type?: unknown }).type === "input_image") ? ["vision" as const] : []),
    ],
  });
  const liveIds = await getLiveModelIds();
  selectPoeRoute(route, liveIds);
  void entry;
}

function createPoeClient(): OpenAI {
  const apiKey = process.env["POE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "POE_API_KEY environment variable is not set. " +
      "Generate an API key at https://poe.com/api/keys and add it as a secret.",
    );
  }
  const client = new OpenAI({ apiKey, baseURL: POE_BASE_URL });
  const responseClient = client.responses as unknown as {
    create: (body: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  const responseCreate = responseClient.create.bind(responseClient);
  responseClient.create = async (body, options) => {
    await validatePoeRequest("responses", body);
    return responseCreate(body, options);
  };

  const chatClient = client.chat.completions as unknown as {
    create: (body: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  const chatCreate = chatClient.create.bind(chatClient);
  chatClient.create = async (body, options) => {
    await validatePoeRequest("chat.completions", body);
    return chatCreate(body, options);
  };
  return client;
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

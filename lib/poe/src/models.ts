import { PoeCapabilityError, PoeModelRegistryError, PoeModelUnavailableError } from "./errors.js";

export type PoeEndpoint = "responses" | "chat.completions";
export type PoeCapability = "vision" | "tools" | "structuredOutput" | "reasoning" | "streaming" | "multiTurn";
export type PoeCapabilityStatus = "yes" | "no" | "unknown";

export interface PoeRouteRegistryEntry {
  readonly route: string;
  readonly provider: "poe";
  readonly modelId: string;
  readonly endpoint: PoeEndpoint;
  readonly capabilities: Readonly<Record<PoeCapability, PoeCapabilityStatus>>;
  readonly supportedParameters: readonly string[];
  readonly fallback:
    | { readonly provider: "openai"; readonly modelEnv: string; readonly modelDefault: string; readonly reason: string }
    | { readonly provider: "heuristic"; readonly reason: string }
    | { readonly provider: "none"; readonly reason: string };
  readonly approvedUse: readonly string[];
  readonly verification: {
    readonly availability: "requires-live-catalogue";
    readonly evidence: string;
    readonly refreshBeforeUse: true;
  };
}

const YES: PoeCapabilityStatus = "yes";
const NO: PoeCapabilityStatus = "no";
const UNKNOWN: PoeCapabilityStatus = "unknown";

const ROUTE_ENTRIES = {
  classify: {
    route: "classify",
    provider: "poe",
    modelId: "Claude-Sonnet-4.6",
    endpoint: "responses",
    capabilities: {
      vision: YES,
      tools: NO,
      structuredOutput: YES,
      reasoning: YES,
      streaming: UNKNOWN,
      multiTurn: NO,
    },
    supportedParameters: [
      "model", "input", "instructions", "output_format", "max_output_tokens",
      "temperature", "truncation", "metadata",
    ],
    fallback: {
      provider: "openai",
      modelEnv: "OPENAI_CLASSIFY_MODEL",
      modelDefault: "gpt-5",
      reason: "Use the separately configured OpenAI vision route when Poe is unavailable.",
    },
    approvedUse: ["bathymetry substrate classification"],
    verification: {
      availability: "requires-live-catalogue",
      evidence: "Poe GET /v1/models plus the Responses vision and structured-output request contract.",
      refreshBeforeUse: true,
    },
  },
  query: {
    route: "query",
    provider: "poe",
    modelId: "Claude-Sonnet-4.6",
    endpoint: "responses",
    capabilities: {
      vision: NO,
      tools: YES,
      structuredOutput: NO,
      reasoning: YES,
      streaming: UNKNOWN,
      multiTurn: YES,
    },
    supportedParameters: [
      "model", "input", "instructions", "tools", "tool_choice",
      "max_output_tokens", "temperature", "truncation", "previous_response_id",
    ],
    fallback: {
      provider: "none",
      reason: "Query results must fail closed rather than silently changing provider or tool semantics.",
    },
    approvedUse: ["authenticated BathyScan terrain questions"],
    verification: {
      availability: "requires-live-catalogue",
      evidence: "Poe GET /v1/models plus the Responses tools and multi-turn request contract.",
      refreshBeforeUse: true,
    },
  },
  help: {
    route: "help",
    provider: "poe",
    modelId: "Claude-Haiku-4.5",
    endpoint: "chat.completions",
    capabilities: {
      vision: NO,
      tools: NO,
      structuredOutput: NO,
      reasoning: NO,
      streaming: NO,
      multiTurn: YES,
    },
    supportedParameters: ["model", "messages", "max_tokens", "temperature", "stream"],
    fallback: {
      provider: "openai",
      modelEnv: "OPENAI_HELP_MODEL",
      modelDefault: "gpt-5",
      reason: "Use the separately configured OpenAI help route with the same grounded context.",
    },
    approvedUse: ["authenticated BathyScan help answers"],
    verification: {
      availability: "requires-live-catalogue",
      evidence: "Poe GET /v1/models plus the Chat Completions text request contract.",
      refreshBeforeUse: true,
    },
  },
  upscale: {
    route: "upscale",
    provider: "poe",
    modelId: "TopazLabs",
    endpoint: "chat.completions",
    capabilities: {
      vision: YES,
      tools: NO,
      structuredOutput: NO,
      reasoning: NO,
      streaming: NO,
      multiTurn: NO,
    },
    supportedParameters: ["model", "messages", "max_tokens", "stream"],
    fallback: {
      provider: "none",
      reason: "The client may use its original image when this image transformation is unavailable.",
    },
    approvedUse: ["authenticated substrate heatmap image upscaling"],
    verification: {
      availability: "requires-live-catalogue",
      evidence: "Poe GET /v1/models plus the Chat Completions multimodal image request contract.",
      refreshBeforeUse: true,
    },
  },
} as const satisfies Record<string, PoeRouteRegistryEntry>;

export const POE_ROUTE_REGISTRY = ROUTE_ENTRIES;
export type PoeRouteKey = keyof typeof POE_ROUTE_REGISTRY;

export const POE_MODELS = {
  CLASSIFY: POE_ROUTE_REGISTRY.classify.modelId,
  QUERY_TOOLS: POE_ROUTE_REGISTRY.query.modelId,
  DESCRIBE_QUICK: POE_ROUTE_REGISTRY.help.modelId,
  REASON_DEEP: "Claude-Opus-4.7",
  QUERY_MULTI: POE_ROUTE_REGISTRY.query.modelId,
  FRESHWATER_CLASS: POE_ROUTE_REGISTRY.classify.modelId,
  UPSCALE: POE_ROUTE_REGISTRY.upscale.modelId,
} as const;

export type PoeModelKey = keyof typeof POE_MODELS;
export type PoeModelName = (typeof POE_MODELS)[PoeModelKey];

export interface PoeRouteRequest {
  readonly route: PoeRouteKey;
  readonly endpoint: PoeEndpoint;
  readonly modelId: string;
  readonly parameters?: readonly string[];
  readonly requiredCapabilities?: readonly PoeCapability[];
}

export interface PoePoeSelection {
  readonly provider: "poe";
  readonly route: PoeRouteKey;
  readonly modelId: string;
  readonly endpoint: PoeEndpoint;
  readonly entry: PoeRouteRegistryEntry;
}

export interface PoeFallbackSelection {
  readonly provider: "openai" | "heuristic";
  readonly route: PoeRouteKey;
  readonly modelId?: string;
  readonly reason: string;
}

export function getPoeRouteEntry(route: PoeRouteKey): PoeRouteRegistryEntry {
  return POE_ROUTE_REGISTRY[route];
}

export function validatePoeRouteRequest(request: PoeRouteRequest): PoeRouteRegistryEntry {
  const entry = getPoeRouteEntry(request.route);
  if (request.modelId !== entry.modelId) {
    throw new PoeModelUnavailableError(
      `No verified registry entry exists for model "${request.modelId}" on route "${request.route}"`,
    );
  }
  if (request.endpoint !== entry.endpoint) {
    throw new PoeCapabilityError(
      `Route "${request.route}" requires the ${entry.endpoint} endpoint, not ${request.endpoint}`,
    );
  }
  for (const capability of request.requiredCapabilities ?? []) {
    if (entry.capabilities[capability] !== "yes") {
      throw new PoeCapabilityError(
        `Route "${request.route}" requires unsupported ${capability} capability`,
      );
    }
  }
  for (const parameter of request.parameters ?? []) {
    if (!entry.supportedParameters.includes(parameter)) {
      throw new PoeCapabilityError(
        `Parameter "${parameter}" is not verified for route "${request.route}"`,
      );
    }
  }
  return entry;
}

export function parsePoeModelIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new PoeModelRegistryError("Poe models response did not contain a data array");
  }
  const ids = (payload as { data: unknown[] }).data.map((model) => {
    if (typeof model !== "object" || model === null || typeof (model as { id?: unknown }).id !== "string" || !(model as { id: string }).id) {
      throw new PoeModelRegistryError("Poe models response contained an entry without a string id");
    }
    return (model as { id: string }).id;
  });
  return ids;
}

export function selectPoeRoute(
  route: PoeRouteKey,
  liveModelIds: readonly string[],
  options: { allowFallback?: boolean } = {},
): PoePoeSelection | PoeFallbackSelection {
  const entry = getPoeRouteEntry(route);
  if (liveModelIds.includes(entry.modelId)) {
    return {
      provider: "poe",
      route,
      modelId: entry.modelId,
      endpoint: entry.endpoint,
      entry,
    };
  }
  if (options.allowFallback && entry.fallback.provider !== "none") {
    return {
      provider: entry.fallback.provider,
      route,
      ...(entry.fallback.provider === "openai" ? { modelId: entry.fallback.modelDefault } : {}),
      reason: entry.fallback.reason,
    };
  }
  throw new PoeModelUnavailableError(
    `Verified Poe model "${entry.modelId}" for route "${route}" was not returned by the live catalogue`,
  );
}

export async function fetchPoeModelIds(
  fetcher: typeof fetch = fetch,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetcher("https://api.poe.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.apiKey ?? process.env["POE_API_KEY"] ?? ""}`,
        Accept: "application/json",
      },
      signal: options.signal,
    });
  } catch {
    throw new PoeModelRegistryError("Could not fetch the Poe model catalogue");
  }
  if (!response.ok) {
    throw new PoeModelRegistryError(`Poe model catalogue returned HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PoeModelRegistryError("Poe model catalogue returned invalid JSON");
  }
  return parsePoeModelIds(payload);
}

export interface ModelDefaults {
  temperature: number;
  maxTokens: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  contextWindow: number;
}

export const MODEL_DEFAULTS: Record<string, ModelDefaults> = {
  "Claude-Opus-4.7": {
    temperature: 0.2,
    maxTokens: 4096,
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 200_000,
  },
  "Claude-Sonnet-4.6": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 200_000,
  },
  "Claude-Sonnet-4.5": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 200_000,
  },
  "Claude-Haiku-4.5": {
    temperature: 0.5,
    maxTokens: 512,
    supportsReasoning: false,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 200_000,
  },
  "GPT-5-Pro": {
    temperature: 0.3,
    maxTokens: 4096,
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 128_000,
  },
  "GPT-5.4": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 128_000,
  },
  "GPT-5-Codex": {
    temperature: 0.2,
    maxTokens: 2048,
    supportsReasoning: false,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 128_000,
  },
  "Gemini-3.1-Pro": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: false,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 1_000_000,
  },
  "Gemini-2.5-Pro": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: false,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 1_000_000,
  },
  "Grok-4": {
    temperature: 0.3,
    maxTokens: 2048,
    supportsReasoning: false,
    supportsVision: true,
    supportsTools: true,
    contextWindow: 128_000,
  },
  "DeepSeek-R1": {
    temperature: 0.2,
    maxTokens: 2048,
    supportsReasoning: true,
    supportsVision: false,
    supportsTools: true,
    contextWindow: 64_000,
  },
};

export function getModelDefaults(model: string): ModelDefaults {
  return MODEL_DEFAULTS[model] ?? {
    temperature: 0.5,
    maxTokens: 1024,
    supportsReasoning: false,
    supportsVision: false,
    supportsTools: false,
    contextWindow: 32_000,
  };
}

export const POE_MODELS = {
  CLASSIFY: "Claude-Sonnet-4.6",
  QUERY_TOOLS: "Claude-Sonnet-4.6",
  DESCRIBE_QUICK: "Claude-Haiku-4.5",
  REASON_DEEP: "Claude-Opus-4.7",
  QUERY_MULTI: "Claude-Sonnet-4.6",
  FRESHWATER_CLASS: "Claude-Sonnet-4.6",
} as const;

export type PoeModelKey = keyof typeof POE_MODELS;
export type PoeModelName = (typeof POE_MODELS)[PoeModelKey];

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

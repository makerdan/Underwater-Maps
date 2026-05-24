export declare const POE_MODELS: {
    readonly CLASSIFY: "Claude-Sonnet-4.6";
    readonly QUERY_TOOLS: "Claude-Sonnet-4.6";
    readonly DESCRIBE_QUICK: "Claude-Haiku-4.5";
    readonly REASON_DEEP: "Claude-Opus-4.7";
    readonly QUERY_MULTI: "Claude-Sonnet-4.6";
    readonly FRESHWATER_CLASS: "Claude-Sonnet-4.6";
};
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
export declare const MODEL_DEFAULTS: Record<string, ModelDefaults>;
export declare function getModelDefaults(model: string): ModelDefaults;

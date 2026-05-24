export declare function withRetry<T>(fn: () => Promise<T>, maxRetries?: number): Promise<T>;

export declare class PoeCache {
    private readonly store;
    get(key: string): string | undefined;
    set(key: string, value: string, ttlMs?: number): void;
    has(key: string): boolean;
    delete(key: string): void;
    clear(): void;
    get size(): number;
}
export declare function hashCacheKey(...parts: string[]): string;
/**
 * Module-level singleton cache shared across all Poe route handlers.
 * Must be cleared in test `beforeEach` hooks (alongside `__resetPoeBreaker()`)
 * to prevent cache hits from one test bleeding into the next.
 */
export declare const globalPoeCache: PoeCache;

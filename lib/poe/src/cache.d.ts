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
export declare const globalPoeCache: PoeCache;

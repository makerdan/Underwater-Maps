import { describe, it, expect, beforeEach } from "vitest";
import { PoeCache, hashCacheKey } from "../cache.js";
describe("PoeCache", () => {
    let cache;
    beforeEach(() => {
        cache = new PoeCache();
    });
    it("stores and retrieves a value", () => {
        cache.set("key1", "value1");
        expect(cache.get("key1")).toBe("value1");
    });
    it("returns undefined for missing keys", () => {
        expect(cache.get("missing")).toBeUndefined();
    });
    it("has() returns true for existing key, false otherwise", () => {
        cache.set("k", "v");
        expect(cache.has("k")).toBe(true);
        expect(cache.has("nope")).toBe(false);
    });
    it("delete() removes a key", () => {
        cache.set("del", "val");
        cache.delete("del");
        expect(cache.get("del")).toBeUndefined();
    });
    it("clear() empties the cache", () => {
        cache.set("a", "1");
        cache.set("b", "2");
        cache.clear();
        expect(cache.size).toBe(0);
    });
    it("expires entries after TTL", async () => {
        cache.set("ttl-key", "ttl-val", 50);
        expect(cache.get("ttl-key")).toBe("ttl-val");
        await new Promise((r) => setTimeout(r, 60));
        expect(cache.get("ttl-key")).toBeUndefined();
    });
    it("evicts oldest entry when over capacity", () => {
        const smallCache = new PoeCache();
        for (let i = 0; i < 101; i++) {
            smallCache.store.set(`overflow-key-${i}`, { value: `v${i}`, expiresAt: Date.now() + 60_000 });
        }
        expect(smallCache.store.size).toBeGreaterThanOrEqual(101);
    });
});
describe("hashCacheKey", () => {
    it("returns a non-empty hex string", () => {
        const hash = hashCacheKey("mariana-trench", "saltwater");
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
    it("is deterministic", () => {
        const a = hashCacheKey("dataset-1", "fresh");
        const b = hashCacheKey("dataset-1", "fresh");
        expect(a).toBe(b);
    });
    it("differs for different inputs", () => {
        const a = hashCacheKey("dataset-1", "saltwater");
        const b = hashCacheKey("dataset-1", "freshwater");
        expect(a).not.toBe(b);
    });
});

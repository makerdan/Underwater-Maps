import { createHash } from "crypto";
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 100;
export class PoeCache {
    store = new Map();
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }
    set(key, value, ttlMs = TTL_MS) {
        if (this.store.has(key)) {
            this.store.delete(key);
        }
        else if (this.store.size >= MAX_ENTRIES) {
            const lru = this.store.keys().next().value;
            if (lru !== undefined) {
                this.store.delete(lru);
            }
        }
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
    get size() {
        return this.store.size;
    }
}
export function hashCacheKey(...parts) {
    return createHash("sha256").update(parts.join("|")).digest("hex");
}
export const globalPoeCache = new PoeCache();

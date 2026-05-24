import { createHash } from "crypto";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 100;

export class PoeCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: string, ttlMs = TTL_MS): void {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export function hashCacheKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export const globalPoeCache = new PoeCache();

const cache = new Map<string, string>();

export function get(key: string): string | undefined {
  return cache.get(key);
}

export function set(key: string, value: string): void {
  cache.set(key, value);
}

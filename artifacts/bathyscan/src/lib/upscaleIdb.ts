/**
 * IndexedDB persistence helpers for the upscaled heatmap cache.
 *
 * Extracted into a separate module so that tests can mock individual
 * functions (idbSet, idbGet, etc.) without touching the hook itself.
 *
 * Keys use the same bitmapHash + factor string used by the in-memory cache in
 * useUpscaledHeatmap.  Entries include a `ts` (write-time timestamp) so
 * old entries can be pruned on startup.
 */

export const IDB_NAME = "bathyscan-upscale-v1";
export const IDB_STORE = "upscaled";
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Maximum total character/byte length of base64 src strings loaded from IDB
 * during cache initialisation.  Prevents startup from loading a huge persisted
 * cache that was accumulated during a long session with the disk almost full.
 * (base64 char ≈ 1 byte; 50 MB ≈ ~125 upscaled 512×512 PNGs.)
 */
export const MAX_IDB_BYTES = 50 * 1024 * 1024; // 50 MB

export interface IdbEntry {
  src: string;
  ts: number;
}

export function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key) as IDBRequest<IdbEntry | undefined>;
      req.onsuccess = () => {
        db.close();
        const entry = req.result;
        if (!entry) { resolve(null); return; }
        if (Date.now() - entry.ts > TTL_MS) { resolve(null); return; }
        resolve(entry.src);
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, src: string): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const entry: IdbEntry = { src, ts: Date.now() };
      const req = tx.objectStore(IDB_STORE).put(entry, key);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (err) {
    const isQuota =
      err instanceof DOMException && err.name === "QuotaExceededError";
    if (isQuota) {
      console.warn("[upscale] IDB write skipped — storage quota exceeded (non-fatal)");
    } else {
      console.warn("[upscale] IDB write failed (non-fatal):", err);
    }
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    // non-fatal
  }
}

/**
 * On module load: open IDB, prune entries older than TTL, and pre-populate
 * the in-memory cache (via callback) from surviving entries so the first
 * render hits the fast path without a network call.
 *
 * The caller passes `onEntry` to populate its own in-memory map.
 */
export async function initIdbCache(
  onEntry: (key: string, src: string) => void,
  maxEntries: number,
  maxBytes: number = MAX_IDB_BYTES,
): Promise<void> {
  try {
    const db = await openIdb();
    const now = Date.now();
    let count = 0;
    let bytes = 0;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const cursorReq = store.openCursor() as IDBRequest<IDBCursorWithValue | null>;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) { resolve(); return; }

        const entry = cursor.value as IdbEntry;
        const key = cursor.key as string;
        const entryBytes = typeof entry.src === "string" ? entry.src.length : 0;

        if (now - entry.ts > TTL_MS) {
          cursor.delete();
        } else if (count < maxEntries && bytes + entryBytes <= maxBytes) {
          onEntry(key, entry.src);
          bytes += entryBytes;
          count++;
        }

        cursor.continue();
      };

      cursorReq.onerror = () => resolve();
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  } catch (err) {
    console.warn("[upscale] IDB init failed (non-fatal):", err);
  }
}

export async function clearIdbStore(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).clear();
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror = () => { db.close(); resolve(); };
    });
  } catch (err) {
    console.warn("[upscale] clearUpscaleCache IDB clear failed (non-fatal):", err);
  }
}

export async function getIdbCacheInfo(): Promise<{ count: number; bytes: number }> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const cursorReq = store.openCursor() as IDBRequest<IDBCursorWithValue | null>;
      let count = 0;
      let bytes = 0;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const entry = cursor.value as IdbEntry;
        count += 1;
        bytes += entry.src.length;
        cursor.continue();
      };

      tx.oncomplete = () => { db.close(); resolve({ count, bytes }); };
      tx.onerror = () => { db.close(); resolve({ count: 0, bytes: 0 }); };
    });
  } catch {
    return { count: 0, bytes: 0 };
  }
}

---
name: laz-perf WASM heap detach on memory growth
description: laz-perf's WASM memory can grow during decompression, detaching any previously-captured ArrayBuffer reference.
---

# laz-perf WASM heap detach on memory growth

## The rule
Never cache `lp.HEAPU8` (or its `.buffer`) in a variable before iterating `getPoint()`.  Read `lp.HEAPU8.buffer` fresh on **every** loop iteration.

```ts
for (let i = 0; i < count; i++) {
  zip.getPoint(dest);
  const view = new DataView(
    (lp as unknown as { HEAPU8: Uint8Array }).HEAPU8.buffer,
    dest,
    ptLen,
  );
  // ...
}
```

**Why:** WebAssembly linear memory can grow (via `memory.grow`) during decompression when the compressed chunk requires more working space than the initial allocation.  A `memory.grow` call replaces the WASM instance's underlying `ArrayBuffer` with a new, larger one and **detaches** all previously-obtained `ArrayBuffer` references.  A cached `heap.buffer` reference becomes detached; constructing a `DataView` on it throws `"Cannot perform DataView constructor on a detached ArrayBuffer"`.

**How to apply:** Any code that reads from `lp.HEAPU8` inside a loop that calls laz-perf WASM functions must re-read `lp.HEAPU8` each iteration.  This applies to `parseLasLaz` in `uploadParsers.ts` and any future WASM-backed code with iterative memory reads.

**Where fixed:** `artifacts/api-server/src/lib/uploadParsers.ts`, the getPoint() loop in `parseLasLaz`.  The bug was invisible under the old vi.mock because the mock used a fixed-size JS ArrayBuffer that never grew.

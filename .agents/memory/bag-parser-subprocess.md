---
name: BAG parser subprocess pitfalls
description: Non-obvious issues when using Python subprocess (h5py+pyproj) for BAG parsing instead of h5wasm.
---

## Rule
Three specific issues must be handled when the Node BAG parser delegates to `bag_parser.py` via `execFile`:

1. **Fill-value filtering**: `_valid_depth` must check `abs(v) != BAG_FILL` (1 000 000). A plain `abs(v) < NAN_TEST` check (1e9) passes fill values through since 1e6 < 1e9.

2. **1-D elevation arrays**: h5wasm-generated fixtures without an explicit `shape` argument store elevation as a flat 1-D HDF5 dataset. `bag_parser.py` must reshape before unpacking `nrows, ncols = elev.shape` — use bbox-derived dims at 0.001°/cell, pad the remainder with BAG_FILL.

3. **Double "BAG parse error:" prefix**: Python writes its own error prefix to stderr, and Node's `execFile` catch wraps that with another prefix. Fix: Python emits the raw exception message (`str(exc)`) and Node adds `"BAG parse error: "` once.

**Why:** These three bugs each caused a separate test failure when the h5wasm → Python migration was done; the fill-value and 1-D issues were pre-existing in the old implementation but masked by h5wasm's different return types.

**How to apply:** Any future changes to `bag_parser.py` or `parseBag` in `uploadParsers.ts` should verify these invariants with the three BAG test files: `parser-bag.test.ts`, `parser.test.ts`, and `bag-upload.test.ts`.

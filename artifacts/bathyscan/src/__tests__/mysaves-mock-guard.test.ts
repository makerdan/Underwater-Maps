/**
 * mysaves-mock-guard.test.ts
 *
 * Type-level guard: ensures that the MySavesSection mock objects used in
 * DatasetPanel tests remain compatible with the real MySavesSectionProps
 * interface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each DatasetPanel test file mocks `@/components/MySavesSection` with a
 * hand-written props type that only lists the props it cares about. If a
 * *required* prop is added to `MySavesSectionProps`, those narrow mocks silently
 * receive `undefined` for the new prop — the DatasetPanel tests stay green while
 * masking the real regression.
 *
 * HOW IT CATCHES DRIFT
 * --------------------
 * The objects below are annotated with the real `MySavesSectionProps` type.
 * TypeScript will produce a compile-time error (caught by `typecheck`, which
 * runs in the fast tier) when any required prop is added without updating
 * the corresponding variant here.
 *
 * WHAT TO DO WHEN THIS FILE ERRORS
 * ---------------------------------
 * 1. Add the new required prop (with a stub function) to every variant below.
 * 2. Update the corresponding `vi.mock("@/components/MySavesSection", ...)` in
 *    each DatasetPanel test file so the mock's destructured parameter type
 *    includes the new prop.
 * 3. Add a runtime `expect` assertion if the new prop needs behavioural coverage.
 */

import { describe, it, expect } from "vitest";
import type { MySavesSectionProps } from "@/components/MySavesSection";
import type { UserCatalogSave } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Stub helpers — typed to match the required prop signatures exactly.
// ---------------------------------------------------------------------------

function stubLoadCatalogSave(_save: UserCatalogSave): void {}
function stubLoadUserDataset(_id: string, _createdAt?: string | null): void {}

// ---------------------------------------------------------------------------
// Canonical full mock
// ---------------------------------------------------------------------------
// Must satisfy MySavesSectionProps completely. A TypeScript error here means a
// new required prop was added to MySavesSectionProps but not yet reflected in
// the mocks — update this object AND each per-test variant below.

const fullMockProps: MySavesSectionProps = {
  onLoadCatalogSave: stubLoadCatalogSave,
  onLoadUserDataset: stubLoadUserDataset,
  // Optional props — listed explicitly so they appear in the diff when
  // a future change makes one of them required.
  onDatasetsRemoved: (_ids: string[]) => {},
  onBrowseDatasets: () => {},
  browseLabel: "BROWSE DATASETS →",
  onAddToView: (_dsId: string) => {},
  visibleDatasetIds: new Set<string>(),
  atViewCap: false,
};

// ---------------------------------------------------------------------------
// Per-test-file mock variants
// ---------------------------------------------------------------------------
// These mirror the subset of props each test file's vi.mock() factory uses.
// All are typed as MySavesSectionProps so TypeScript enforces that required
// props are present even when the test itself only inspects a subset.

/**
 * DatasetPanel.addToView.test.tsx
 * Uses: onAddToView, visibleDatasetIds, atViewCap
 */
const addToViewMockProps: MySavesSectionProps = {
  onLoadCatalogSave: stubLoadCatalogSave, // required
  onLoadUserDataset: stubLoadUserDataset, // required
  onAddToView: (_dsId: string) => {},
  visibleDatasetIds: new Set<string>(),
  atViewCap: false,
};

/**
 * DatasetPanel.folderMove.test.tsx
 * Uses: onLoadUserDataset, onLoadCatalogSave, onBrowseDatasets
 */
const folderMoveMockProps: MySavesSectionProps = {
  onLoadCatalogSave: stubLoadCatalogSave,
  onLoadUserDataset: stubLoadUserDataset,
  onBrowseDatasets: () => {},
};

/**
 * DatasetPanel.myLibraryCollapse.test.tsx
 * Renders a stub <div> — does not destructure any props.
 */
const myLibraryCollapseMockProps: MySavesSectionProps = {
  onLoadCatalogSave: stubLoadCatalogSave,
  onLoadUserDataset: stubLoadUserDataset,
};

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------
// The meaningful check is compile-time (see above). These runtime assertions
// catch the unlikely case where a required function is accidentally set to
// undefined at runtime (e.g. via Object.assign) and also ensure the file is
// treated as a real test by vitest rather than silently skipped.

describe("MySavesSection mock guard — required props present in all variants", () => {
  it("full mock: required function props are callable", () => {
    expect(typeof fullMockProps.onLoadCatalogSave).toBe("function");
    expect(typeof fullMockProps.onLoadUserDataset).toBe("function");
  });

  it("addToView variant: required function props are callable", () => {
    expect(typeof addToViewMockProps.onLoadCatalogSave).toBe("function");
    expect(typeof addToViewMockProps.onLoadUserDataset).toBe("function");
  });

  it("folderMove variant: required function props are callable", () => {
    expect(typeof folderMoveMockProps.onLoadCatalogSave).toBe("function");
    expect(typeof folderMoveMockProps.onLoadUserDataset).toBe("function");
  });

  it("myLibraryCollapse variant: required function props are callable", () => {
    expect(typeof myLibraryCollapseMockProps.onLoadCatalogSave).toBe("function");
    expect(typeof myLibraryCollapseMockProps.onLoadUserDataset).toBe("function");
  });
});

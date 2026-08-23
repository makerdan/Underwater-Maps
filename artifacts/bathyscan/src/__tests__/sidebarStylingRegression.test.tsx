/**
 * Structural regression guards for the expanded desktop sidebar.
 *
 * These checks intentionally avoid mounting the full WebGL App shell. The
 * sidebar controls are coupled to the scene lifecycle, while the styling
 * contracts can be checked directly and cheaply:
 *   - App keeps an accessible hide control wired to the collapsed-state setter.
 *   - Collections keeps its readable heading and visible divider.
 *   - Default-map options keep a high-contrast foreground/background pair.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { DefaultMapLoadPicker } from "@/components/DefaultMapLoadPicker";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const collectionsSource = readFileSync(
  resolve(process.cwd(), "src/components/CollectionsSection.tsx"),
  "utf8",
);

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (selector: (state: { waterType: string }) => unknown) =>
    selector({ waterType: "saltwater" }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({
    data: [{ id: "preset-1", name: "Harbor Floor" }],
    isLoading: false,
  }),
  useGetUserDatasets: () => ({
    data: [{ id: "upload-1", name: "Survey Upload" }],
    isLoading: false,
  }),
  getGetDatasetsQueryKey: () => ["datasets"],
  getGetUserDatasetsQueryKey: () => ["user-datasets"],
}));

describe("expanded desktop sidebar styling contracts", () => {
  it("keeps the Hide side pane control accessible and wired to collapse state", () => {
    expect(appSource).toContain('aria-label="Hide side pane"');
    expect(appSource).toContain("onClick={() => setSidePaneCollapsed(true)}");
    expect(appSource).toContain('aria-label="Show side pane"');
    expect(appSource).toContain("onClick={() => setSidePaneCollapsed(false)}");
  });

  it("keeps the Dataset Collections label and visible divider", () => {
    expect(collectionsSource).toContain('data-testid="collections-section"');
    expect(collectionsSource).toContain("DATASET COLLECTIONS");
    expect(collectionsSource).toContain(
      'borderTop: "1px solid rgba(255,255,255,0.9)"',
    );
  });

  it("keeps default map load options readable on the dark sidebar", async () => {
    const onChange = vi.fn();
    render(<DefaultMapLoadPicker value={null} onChange={onChange} />);

    const select = screen.getByTestId("default-map-load-select");
    const options = within(select).getAllByRole("option");

    expect(options).toHaveLength(3);
    for (const option of options.slice(1)) {
      expect(option).toHaveStyle({
        color: "#ffffff",
        background: "#00101f",
      });
    }

    fireEvent.change(select, { target: { value: "preset:preset-1" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "preset",
      id: "preset-1",
    });
  });
});
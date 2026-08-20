import { describe, expect, it } from "vitest";

import { OVERLAY_Z } from "@/lib/overlayScale";

describe("overlay stacking contract", () => {
  it("keeps each visible overlay family in an explicit order", () => {
    expect(OVERLAY_Z.banner).toBeLessThan(OVERLAY_Z.drawer);
    expect(OVERLAY_Z.drawer).toBeLessThan(OVERLAY_Z.contextMenu);
    expect(OVERLAY_Z.contextMenu).toBeLessThan(OVERLAY_Z.dialog);
    expect(OVERLAY_Z.dialog).toBeLessThan(OVERLAY_Z.loader);
    expect(OVERLAY_Z.loader).toBeLessThan(OVERLAY_Z.toast);
  });
});
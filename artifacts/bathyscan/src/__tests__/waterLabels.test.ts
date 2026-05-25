import { describe, it, expect } from "vitest";
import { waterLabels } from "@/lib/waterLabels";

describe("waterLabels", () => {
  it("returns saltwater terminology for saltwater mode", () => {
    const l = waterLabels("saltwater");
    expect(l.environment).toBe("Saltwater");
    expect(l.floor).toBe("seafloor");
    expect(l.explorer).toBe("Seafloor Explorer");
    expect(l.aiPersona).toMatch(/marine/i);
    expect(l.colormapDefault).toBe("ocean");
  });

  it("returns freshwater terminology for freshwater mode", () => {
    const l = waterLabels("freshwater");
    expect(l.environment).toBe("Freshwater");
    expect(l.floor).toBe("lake bed");
    expect(l.explorer).toBe("Lake Explorer");
    expect(l.aiPersona).toMatch(/limnolog/i);
    expect(l.colormapDefault).toBe("freshwater");
  });

  it("uses distinct floor terminology between the two modes", () => {
    expect(waterLabels("saltwater").floor).not.toBe(waterLabels("freshwater").floor);
  });
});

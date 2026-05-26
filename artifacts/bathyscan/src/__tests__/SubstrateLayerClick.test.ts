/**
 * Pins the 3D SubstrateLayer click → uiStore.selectedSubstrate mapping.
 *
 * The fixture is shared with OverviewMapSubstrateClick.test.tsx so that
 * adding a property in one place forces both the 2D and 3D tests to be
 * updated — preventing the two views from silently diverging.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SubstrateFeature } from "@workspace/api-client-react";
import { buildSelectedSubstrate } from "@/components/SubstrateLayer";
import { useUiStore } from "@/lib/uiStore";
import { substrateCollection } from "./substrateFixture";

const { metadata, features } = substrateCollection;
const { sourceName, creditUrl } = metadata as { sourceName: string; creditUrl: string };

describe("SubstrateLayer buildSelectedSubstrate → uiStore.selectedSubstrate", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedSubstrate: null, substrateColorMode: true });
  });

  it("maps a Polygon feature's full property set into selectedSubstrate (ENC chart citation)", () => {
    const feature = features[0] as SubstrateFeature;
    const result = buildSelectedSubstrate(feature, sourceName, creditUrl);

    useUiStore.getState().setSelectedSubstrate(result);
    const sel = useUiStore.getState().selectedSubstrate;

    expect(sel).not.toBeNull();
    expect(sel!.unitId).toBe("poly-1");
    expect(sel!.substrate).toBe("sand");
    expect(sel!.cmecsCode).toBe("SBS_SA");
    expect(sel!.natsur).toBe("Sandy bottom per S-57 NATSUR.");
    expect(sel!.encChart).toBe("US5AK4DM");
    expect(sel!.sourceName).toBe("Test Substrate Source");
    expect(sel!.creditUrl).toBe("https://example.test/credit");
  });

  it("maps a MultiPolygon feature carrying a TPWD lake-page link through encChart", () => {
    const feature = features[1] as SubstrateFeature;
    const result = buildSelectedSubstrate(feature, sourceName, creditUrl);

    useUiStore.getState().setSelectedSubstrate(result);
    const sel = useUiStore.getState().selectedSubstrate;

    expect(sel).not.toBeNull();
    expect(sel!.unitId).toBe("poly-2");
    expect(sel!.substrate).toBe("gravel");
    expect(sel!.cmecsCode).toBe("SBS_GR");
    expect(sel!.natsur).toBe("TPWD lake-survey: gravel substrate near boat ramp.");
    expect(sel!.encChart).toBe(
      "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/example",
    );
    expect(sel!.sourceName).toBe("Test Substrate Source");
    expect(sel!.creditUrl).toBe("https://example.test/credit");
  });

  it("returns all required SelectedSubstrate keys — no silent undefined fields", () => {
    const feature = features[0] as SubstrateFeature;
    const result = buildSelectedSubstrate(feature, sourceName, creditUrl);

    const required: Array<keyof typeof result> = [
      "unitId",
      "substrate",
      "shoreZoneClass",
      "cmecsCode",
      "color",
      "szMaterial",
      "szForm",
      "areaSqM",
      "natsur",
      "encChart",
      "sourceName",
      "creditUrl",
    ];
    for (const key of required) {
      expect(result, `key "${key}" must be present`).toHaveProperty(key);
      expect(result[key], `key "${key}" must not be undefined`).not.toBeUndefined();
    }
  });

  it("uses collection-level sourceName and creditUrl, not a hardcoded fallback", () => {
    const feature = features[0] as SubstrateFeature;
    const result = buildSelectedSubstrate(feature, "Custom Source", "https://custom.url/");

    expect(result.sourceName).toBe("Custom Source");
    expect(result.creditUrl).toBe("https://custom.url/");
  });
});

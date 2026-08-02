/**
 * reverseGeocode.test.ts — best-effort Nominatim reverse geocoding used to
 * name auto-created area-request folders.
 *
 * Verifies:
 *  - place-name extraction preference (name → locality → display_name)
 *  - region ("State" / country) suffixing without duplication
 *  - null on upstream error body, non-OK status, network failure, bad coords
 *  - per-process result caching (one upstream call per rounded point)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  placeNameForPoint,
  placeNameFromNominatim,
  __clearReverseGeocodeCache,
} from "../reverseGeocode.js";

const fetchMock = vi.fn();

beforeEach(() => {
  __clearReverseGeocodeCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe("placeNameFromNominatim", () => {
  it("prefers the feature's own name and appends the state", () => {
    expect(
      placeNameFromNominatim({
        name: "Sitka Sound",
        display_name: "Sitka Sound, Sitka, Alaska, United States",
        address: { city: "Sitka", state: "Alaska" },
      }),
    ).toBe("Sitka Sound, Alaska");
  });

  it("falls back to a locality key when name is missing", () => {
    expect(
      placeNameFromNominatim({
        display_name: "Sitka, Alaska, United States",
        address: { city: "Sitka", state: "Alaska" },
      }),
    ).toBe("Sitka, Alaska");
  });

  it("falls back to the first display_name segment when address is empty", () => {
    expect(
      placeNameFromNominatim({ display_name: "Gulf of Alaska" }),
    ).toBe("Gulf of Alaska");
  });

  it("uses country when state is missing and skips duplicate regions", () => {
    expect(
      placeNameFromNominatim({
        name: "Iceland",
        address: { country: "Iceland" },
      }),
    ).toBe("Iceland");
    expect(
      placeNameFromNominatim({
        name: "Reykjavík",
        address: { country: "Iceland" },
      }),
    ).toBe("Reykjavík, Iceland");
  });

  it("returns null when nothing usable is present", () => {
    expect(placeNameFromNominatim({})).toBeNull();
  });
});

describe("placeNameForPoint", () => {
  it("returns the parsed place name on success", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ name: "Sitka", address: { state: "Alaska" } }),
    );
    await expect(placeNameForPoint(57.05, -135.33)).resolves.toBe(
      "Sitka, Alaska",
    );
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("lat=57.05");
    expect(url).toContain("lon=-135.33");
  });

  it("returns null on a Nominatim error body", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: "Unable to geocode" }));
    await expect(placeNameForPoint(0, -160)).resolves.toBeNull();
  });

  it("returns null on non-OK status and on network failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false } as unknown as Response);
    await expect(placeNameForPoint(10, 10)).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(placeNameForPoint(20, 20)).resolves.toBeNull();
  });

  it("returns null when AbortSignal.timeout fires (TimeoutError DOMException)", async () => {
    // Simulate the DOMException thrown by AbortSignal.timeout when the 3.5 s
    // budget expires — must not propagate as an unhandled rejection.
    const err = new DOMException("signal timed out", "TimeoutError");
    fetchMock.mockRejectedValueOnce(err);
    await expect(placeNameForPoint(57.05, -135.33)).resolves.toBeNull();
  });

  it("returns null when the fetch is aborted (AbortError)", async () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(err);
    await expect(placeNameForPoint(30, 30)).resolves.toBeNull();
  });

  it("returns null for non-finite coordinates without fetching", async () => {
    await expect(placeNameForPoint(NaN, 0)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches results per rounded point (success and failure)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ name: "Sitka" }));
    await placeNameForPoint(57.05, -135.33);
    await expect(placeNameForPoint(57.051, -135.329)).resolves.toBe("Sitka");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await placeNameForPoint(1, 1);
    await expect(placeNameForPoint(1, 1)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

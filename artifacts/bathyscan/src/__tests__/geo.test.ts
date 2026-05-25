import { describe, it, expect } from "vitest";
import { haversineDistance } from "@/lib/geo";

describe("haversineDistance", () => {
  it("returns 0 for identical coordinates", () => {
    const p = { lon: -122.4194, lat: 37.7749 };
    expect(haversineDistance(p, p)).toBe(0);
  });

  it("computes ~111 km for 1 degree of latitude at the equator", () => {
    const a = { lon: 0, lat: 0 };
    const b = { lon: 0, lat: 1 };
    const d = haversineDistance(a, b);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("computes the SF to NYC great-circle distance within 1%", () => {
    // San Francisco to New York City: known great-circle ~4129 km
    const sf = { lon: -122.4194, lat: 37.7749 };
    const nyc = { lon: -74.006, lat: 40.7128 };
    const d = haversineDistance(sf, nyc);
    expect(d).toBeGreaterThan(4090);
    expect(d).toBeLessThan(4170);
  });

  it("is symmetric in argument order", () => {
    const a = { lon: 11.3, lat: 142.2 };
    const b = { lon: 11.4, lat: 142.3 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 9);
  });

  it("computes short Mariana-area distance correctly", () => {
    // Two points ~1 km apart in the Mariana Trench area
    const a = { lon: 142.1951, lat: 11.3733 };
    const b = { lon: 142.205, lat: 11.3733 };
    const d = haversineDistance(a, b);
    expect(d).toBeGreaterThan(1.05);
    expect(d).toBeLessThan(1.15);
  });
});

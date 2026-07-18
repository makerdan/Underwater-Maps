import { describe, it, expect } from "vitest";
import {
  parseCoordinates,
  validateRadius,
  radiusToKm,
  approxBboxForRadius,
  COORD_SEARCH_MIN_RADIUS_KM,
  COORD_SEARCH_MAX_RADIUS_KM,
  KM_PER_NMI,
} from "../coordinateParser";

function expectCoords(input: string, lat: number, lon: number) {
  const res = parseCoordinates(input);
  expect(res.ok, `expected parse of "${input}" to succeed: ${res.ok ? "" : res.error}`).toBe(true);
  if (res.ok) {
    expect(res.coords.lat).toBeCloseTo(lat, 5);
    expect(res.coords.lon).toBeCloseTo(lon, 5);
  }
}

describe("parseCoordinates — decimal degrees", () => {
  it("parses signed decimals with comma", () => {
    expectCoords("58.30126, -134.41978", 58.30126, -134.41978);
  });
  it("parses signed decimals with whitespace only", () => {
    expectCoords("58.3 -134.42", 58.3, -134.42);
  });
  it("parses decimals with hemisphere suffixes", () => {
    expectCoords("58.3 N, 134.42 W", 58.3, -134.42);
    expectCoords("58.3N 134.42W", 58.3, -134.42);
    expectCoords("12.5 S, 45.25 E", -12.5, 45.25);
  });
  it("parses hemisphere prefixes", () => {
    expectCoords("N58.3, W134.42", 58.3, -134.42);
  });
  it("accepts swapped order when hemispheres disambiguate", () => {
    expectCoords("134.42 W, 58.3 N", 58.3, -134.42);
  });
});

describe("parseCoordinates — degrees + decimal minutes", () => {
  it("parses spaced DDM with hemisphere letters", () => {
    expectCoords("58 18.076 N, 134 25.187 W", 58 + 18.076 / 60, -(134 + 25.187 / 60));
  });
  it("parses symbol DDM", () => {
    expectCoords("58°18.076'N 134°25.187'W", 58 + 18.076 / 60, -(134 + 25.187 / 60));
  });
  it("parses DDM with negative degrees", () => {
    expectCoords("58 18.0, -134 25.2", 58.3, -(134 + 25.2 / 60));
  });
});

describe("parseCoordinates — DMS", () => {
  it("parses symbol DMS", () => {
    expectCoords(
      `58°18'4.5"N 134°25'11.2"W`,
      58 + 18 / 60 + 4.5 / 3600,
      -(134 + 25 / 60 + 11.2 / 3600),
    );
  });
  it("parses spaced DMS with comma", () => {
    expectCoords("58 18 04.5 N, 134 25 11.2 W", 58 + 18 / 60 + 4.5 / 3600, -(134 + 25 / 60 + 11.2 / 3600));
  });
  it("parses spaced DMS without letters (even split)", () => {
    expectCoords("58 18 00 -134 25 12", 58.3, -(134 + 25.2 / 60));
  });
});

describe("parseCoordinates — boundary values & whitespace", () => {
  it("accepts exactly ±90 latitude and ±180 longitude", () => {
    expectCoords("90, 180", 90, 180);
    expectCoords("-90, -180", -90, -180);
    expectCoords("90 N, 180 E", 90, 180);
    expectCoords("90 S, 180 W", -90, -180);
  });
  it("rejects just past the boundary", () => {
    expect(parseCoordinates("90.0001, 0").ok).toBe(false);
    expect(parseCoordinates("0, 180.0001").ok).toBe(false);
    expect(parseCoordinates("-90.0001, 0").ok).toBe(false);
    expect(parseCoordinates("0, -180.0001").ok).toBe(false);
  });
  it("accepts zero, zero", () => {
    expectCoords("0, 0", 0, 0);
  });
  it("tolerates surrounding and internal extra whitespace", () => {
    expectCoords("   58.3 ,   -134.42   ", 58.3, -134.42);
    expectCoords("58   18.076   N,   134   25.187   W", 58 + 18.076 / 60, -(134 + 25.187 / 60));
  });
  it("accepts mixed formats per half (decimal lat, DMS lon)", () => {
    expectCoords(`58.5 N, 134°25'11.2"W`, 58.5, -(134 + 25 / 60 + 11.2 / 3600));
    expectCoords("58 18.076 N, 134.42 W", 58 + 18.076 / 60, -134.42);
  });
  it("accepts lowercase hemisphere letters", () => {
    expectCoords("58.3 n, 134.42 w", 58.3, -134.42);
    expectCoords("12.5 s, 45.25 e", -12.5, 45.25);
  });
  it("DMS just inside the ±90 corner is accepted", () => {
    expectCoords("89 59 59.9 N, 0", 89 + 59 / 60 + 59.9 / 3600, 0);
  });
});

describe("parseCoordinates — errors", () => {
  it("rejects empty input", () => {
    const res = parseCoordinates("   ");
    expect(res.ok).toBe(false);
  });
  it("rejects out-of-range latitude", () => {
    const res = parseCoordinates("95.0, 10.0");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Latitude .*out of range/);
  });
  it("rejects out-of-range longitude", () => {
    const res = parseCoordinates("45.0, 200.0");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Longitude .*out of range/);
  });
  it("rejects minutes >= 60", () => {
    const res = parseCoordinates("58 61.0 N, 134 25.2 W");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Minutes/);
  });
  it("rejects seconds >= 60", () => {
    const res = parseCoordinates("58 18 75 N, 134 25 11 W");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Seconds/);
  });
  it("rejects fractional degrees in DDM", () => {
    const res = parseCoordinates("58.5 18.0 N, 134 25.2 W");
    expect(res.ok).toBe(false);
  });
  it("rejects minus sign combined with S/W", () => {
    const res = parseCoordinates("58.3 N, -134.42 W");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/minus sign or S\/W/);
  });
  it("rejects lat hemisphere on longitude half", () => {
    const res = parseCoordinates("58.3 N, 134.42 N");
    expect(res.ok).toBe(false);
  });
  it("rejects garbage", () => {
    const res = parseCoordinates("hello world");
    expect(res.ok).toBe(false);
  });
  it("rejects a single number", () => {
    const res = parseCoordinates("58.3");
    expect(res.ok).toBe(false);
  });
});

describe("validateRadius", () => {
  it("accepts a normal km radius", () => {
    expect(validateRadius(10, "km")).toBeNull();
  });
  it("accepts a normal nmi radius", () => {
    expect(validateRadius(5, "nmi")).toBeNull();
  });
  it("rejects zero and negative", () => {
    expect(validateRadius(0, "km")).toMatch(/greater than zero/);
    expect(validateRadius(-3, "km")).toMatch(/greater than zero/);
  });
  it("rejects below server minimum", () => {
    expect(validateRadius(COORD_SEARCH_MIN_RADIUS_KM / 2, "km")).toMatch(/too small/);
  });
  it("rejects above server maximum", () => {
    expect(validateRadius(COORD_SEARCH_MAX_RADIUS_KM + 1, "km")).toMatch(/too large/);
    expect(validateRadius(COORD_SEARCH_MAX_RADIUS_KM / KM_PER_NMI + 1, "nmi")).toMatch(/too large/);
  });
});

describe("radiusToKm", () => {
  it("converts nmi to km", () => {
    expect(radiusToKm(10, "nmi")).toBeCloseTo(18.52, 5);
    expect(radiusToKm(10, "km")).toBe(10);
  });
});

describe("approxBboxForRadius", () => {
  it("produces a bbox containing the centre", () => {
    const b = approxBboxForRadius(58.3, -134.42, 10);
    expect(b.north).toBeGreaterThan(58.3);
    expect(b.south).toBeLessThan(58.3);
    expect(b.east).toBeGreaterThan(-134.42);
    expect(b.west).toBeLessThan(-134.42);
    // ~10 km ≈ 0.0898° of latitude
    expect(b.north - 58.3).toBeCloseTo(10 / 111.32, 3);
  });
  it("clamps latitude at the poles", () => {
    const b = approxBboxForRadius(89.99, 0, 50);
    expect(b.north).toBeLessThanOrEqual(90);
  });
});

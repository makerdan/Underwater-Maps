import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import waterTemperatureRouter, { pickCurrentSst } from "../water-temperature";

function makeApp() {
  const app = express();
  app.use(waterTemperatureRouter);
  return app;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("pickCurrentSst", () => {
  it("returns the sample matching the current UTC hour", () => {
    const now = new Date("2026-05-25T14:00:00Z");
    const json = {
      hourly: {
        time: ["2026-05-25T13:00", "2026-05-25T14:00", "2026-05-25T15:00"],
        sea_surface_temperature: [10.111, 11.234, 12.5],
      },
    };
    const picked = pickCurrentSst(json, now);
    expect(picked).not.toBeNull();
    expect(picked!.sst).toBe(11.23);
    expect(picked!.timestamp).toBe("2026-05-25T14:00:00.000Z");
  });

  it("falls back to the last finite sample when current hour is missing", () => {
    const now = new Date("2026-05-25T14:30:00Z");
    const json = {
      hourly: {
        time: ["2026-05-25T10:00", "2026-05-25T11:00"],
        sea_surface_temperature: [9.5, 9.7],
      },
    };
    const picked = pickCurrentSst(json, now);
    expect(picked).not.toBeNull();
    expect(picked!.sst).toBe(9.7);
  });

  it("skips null entries from upstream", () => {
    const now = new Date("2026-05-25T14:00:00Z");
    const json = {
      hourly: {
        time: ["2026-05-25T13:00", "2026-05-25T14:00"],
        sea_surface_temperature: [8.2, null as unknown as number],
      },
    };
    const picked = pickCurrentSst(json, now);
    expect(picked).not.toBeNull();
    expect(picked!.sst).toBe(8.2);
  });

  it("returns null when nothing is finite", () => {
    const json = { hourly: { time: ["2026-05-25T14:00"], sea_surface_temperature: [null as unknown as number] } };
    expect(pickCurrentSst(json, new Date("2026-05-25T14:00:00Z"))).toBeNull();
  });

  it("returns null on empty response", () => {
    expect(pickCurrentSst({}, new Date())).toBeNull();
  });
});

describe("GET /water-temperature", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects invalid coordinates", async () => {
    const res = await request(makeApp()).get("/water-temperature?lat=200&lon=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns available=true with live SST when upstream responds", async () => {
    const now = new Date();
    const top = new Date(now);
    top.setUTCMinutes(0, 0, 0);
    const hourIso = top.toISOString().slice(0, 13);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        hourly: {
          time: [`${hourIso}:00`],
          sea_surface_temperature: [13.45],
        },
      }),
    );

    const res = await request(makeApp()).get("/water-temperature?lat=55.5&lon=-132.5");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.sstCelsius).toBe(13.45);
    expect(res.body.lat).toBe(55.5);
    expect(res.body.lon).toBe(-132.5);
    expect(res.body.source).toMatch(/Open-Meteo/);
    expect(typeof res.body.sourceUrl).toBe("string");
  });

  it("returns available=false when upstream errors", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const res = await request(makeApp()).get("/water-temperature?lat=10&lon=20");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.sstCelsius).toBeUndefined();
    expect(res.body.source).toMatch(/Open-Meteo/);
  });

  it("returns available=false when upstream returns non-OK", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, false, 503));
    const res = await request(makeApp()).get("/water-temperature?lat=10&lon=20");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });
});

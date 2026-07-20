import { describe, it, expect, afterEach } from "vitest";
import { resetPoeClient, getPoeClient } from "../client.js";

const originalEnv = process.env["POE_API_KEY"];

describe("getPoeClient", () => {
  afterEach(() => {
    resetPoeClient();
    if (originalEnv === undefined) {
      delete process.env["POE_API_KEY"];
    } else {
      process.env["POE_API_KEY"] = originalEnv;
    }
  });

  it("throws when POE_API_KEY is not set", () => {
    delete process.env["POE_API_KEY"];
    resetPoeClient();
    expect(() => getPoeClient()).toThrow("POE_API_KEY");
  });

  it("returns an OpenAI client instance when POE_API_KEY is set", () => {
    process.env["POE_API_KEY"] = "test-key-123";
    resetPoeClient();
    const client = getPoeClient();
    expect(client).toBeTruthy();
    expect(typeof client.chat.completions.create).toBe("function");
  });

  it("returns the same singleton on repeated calls", () => {
    process.env["POE_API_KEY"] = "test-key-123";
    resetPoeClient();
    const a = getPoeClient();
    const b = getPoeClient();
    expect(a).toBe(b);
  });

  it("resets the singleton with resetPoeClient()", () => {
    process.env["POE_API_KEY"] = "test-key-123";
    resetPoeClient();
    const a = getPoeClient();
    resetPoeClient();
    const b = getPoeClient();
    expect(a).not.toBe(b);
  });

  it("client baseURL points at Poe API", () => {
    process.env["POE_API_KEY"] = "test-key-abc";
    resetPoeClient();
    const client = getPoeClient();
    const base = (client as unknown as { baseURL: string }).baseURL;
    expect(base).toContain("poe.com");
  });
});

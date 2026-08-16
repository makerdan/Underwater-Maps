/**
 * Unit tests for the shared formatBytes helper.
 */

import { describe, it, expect } from "vitest";
import { formatBytes } from "@/lib/formatBytes";

describe("formatBytes", () => {
  it("formats bytes below 1 KiB as plain bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats values in the KiB range", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats values in the MiB range", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    // Just below 1 GiB
    const justBelowGib = 1024 * 1024 * 1024 - 1;
    expect(formatBytes(justBelowGib)).toMatch(/MB$/);
  });

  it("formats exactly 1 GiB as '1 GB' (no trailing 0 MB)", () => {
    const oneGib = 1024 * 1024 * 1024;
    expect(formatBytes(oneGib)).toBe("1 GB");
  });

  it("formats 1 GiB + 256 MiB as '1 GB 256 MB'", () => {
    const b = 1024 * 1024 * 1024 + 256 * 1024 * 1024;
    expect(formatBytes(b)).toBe("1 GB 256 MB");
  });

  it("formats 2 GiB exactly as '2 GB' (no trailing 0 MB)", () => {
    const twoGib = 2 * 1024 * 1024 * 1024;
    expect(formatBytes(twoGib)).toBe("2 GB");
  });

  it("formats a large multi-GiB value with remainder", () => {
    // 3 GiB + 100 MiB
    const b = 3 * 1024 * 1024 * 1024 + 100 * 1024 * 1024;
    expect(formatBytes(b)).toBe("3 GB 100 MB");
  });
});

/**
 * objectStorage-sidecar.test.ts
 *
 * Unit tests for the sidecar boundaries in ObjectStorageService:
 *
 *  1. `getObjectEntityUploadURL` — the sidecar signed-URL response must have
 *     a valid `signed_url` string; missing or wrong-type values must throw.
 *
 *  2. `parseObjectPath` (exercised indirectly) — a path whose second segment
 *     is empty (e.g. `//objectName`) must throw a descriptive error instead
 *     of silently producing an empty bucket name.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage — ObjectStorageService instantiates a Storage
// client at module-level, so this must come before the import.
// ---------------------------------------------------------------------------
const { mockFileFactory } = vi.hoisted(() => ({
  mockFileFactory: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: vi.fn().mockReturnValue({
      file: mockFileFactory,
      getFiles: vi.fn().mockResolvedValue([[]]),
    }),
  })),
  File: vi.fn(),
}));

vi.mock("./objectAcl", () => ({
  canAccessObject: vi.fn(),
  getObjectAclPolicy: vi.fn(),
  setObjectAclPolicy: vi.fn(),
  ObjectPermission: { READ: "READ", WRITE: "WRITE" },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { ObjectStorageService } from "../objectStorage.js";

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------
function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function makeFetchNotOk(status = 503): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.stubEnv("PRIVATE_OBJECT_DIR", "/test-bucket/private");
  mockFileFactory.mockReset();
  mockFileFactory.mockReturnValue({ __mockFile: true });
});

// ---------------------------------------------------------------------------
// Suite 1: signed-URL sidecar validation via getObjectEntityUploadURL
// ---------------------------------------------------------------------------

describe("getObjectEntityUploadURL — sidecar signed-URL validation", () => {
  it("returns the URL when sidecar responds with a valid signed_url", async () => {
    const fakeUrl = "https://storage.googleapis.com/bucket/object?sig=abc";
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: fakeUrl }));

    const svc = new ObjectStorageService();
    const url = await svc.getObjectEntityUploadURL();
    expect(url).toBe(fakeUrl);
  });

  it("throws when signed_url is missing from the sidecar response", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ other_field: "unexpected" }));

    const svc = new ObjectStorageService();
    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow();
  });

  it("throws when signed_url is a number instead of a string URL", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: 42 }));

    const svc = new ObjectStorageService();
    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow();
  });

  it("throws when signed_url is an empty string (not a valid URL)", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: "" }));

    const svc = new ObjectStorageService();
    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow();
  });

  it("throws when signed_url is a non-URL plain string", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: "not-a-url" }));

    const svc = new ObjectStorageService();
    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow();
  });

  it("throws descriptively when sidecar returns non-OK status", async () => {
    vi.stubGlobal("fetch", makeFetchNotOk(403));

    const svc = new ObjectStorageService();
    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow(
      /sign object URL.*403/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2: pathParts guard — empty bucket name segment
//
// parseObjectPath is internal, so we reach it through getObjectEntityFile
// by setting PRIVATE_OBJECT_DIR to a leading-slash path whose second segment
// is empty (//objectName pattern). We use listUploadObjectPaths to exercise
// the same parseObjectPath call path.
// ---------------------------------------------------------------------------

describe("parseObjectPath — empty bucket name segment guard", () => {
  it("throws a descriptive error when PRIVATE_OBJECT_DIR produces an empty bucket segment", async () => {
    // A PRIVATE_OBJECT_DIR of "/" means fullPath becomes "//uploads/<id>",
    // so pathParts[1] is "" — our new guard must catch this.
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/");

    const svc = new ObjectStorageService();
    // getObjectEntityUploadURL calls parseObjectPath internally
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signed_url: "https://example.com/signed" }),
      } as unknown as Response),
    );

    await expect(svc.getObjectEntityUploadURL()).rejects.toThrow(
      /bucket name segment is missing/i,
    );
  });
});

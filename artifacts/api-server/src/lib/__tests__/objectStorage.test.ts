/**
 * objectStorage.test.ts
 *
 * Unit tests for `ObjectStorageService.getObjectEntityFile()` path traversal
 * prevention.
 *
 * The method must reject any objectPath that — after percent-decoding and
 * POSIX normalization — would escape the private object directory. All such
 * attempts must throw `ObjectNotFoundError` (or equivalent) before the GCS
 * client is ever contacted, preventing both directory traversal and information
 * disclosure about the underlying bucket structure.
 *
 * TOCTOU note: `getObjectEntityFile` no longer performs an existence pre-check
 * via `file.exists()`. It returns the GCS `File` handle directly after the
 * path guard so the caller performs the actual I/O (streaming / delete / ACL
 * set) without the TOCTOU race. ObjectNotFoundError is therefore only thrown
 * by the path guard itself; callers must handle GCS 404 errors at the point of
 * actual read/write.
 *
 * Test scenarios
 * --------------
 * 1. Percent-encoded dot-dot: %2e%2e / %2E%2E
 * 2. Absolute path injection: /etc/passwd style
 * 3. Dot-only segment: /objects/.
 * 4. Literal double-dot: /objects/../secret
 * 5. Mixed encoding: valid-looking path with encoded traversal in a segment
 * 6. Double percent-encoding: %252e%252e (decoded once → %2e%2e)
 * 7. Null byte injection: %00
 * 8. Valid path → reaches GCS client (file handle returned, no exists() call)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage.js";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage so getObjectEntityFile never makes real network
// calls. We track whether bucket().file() was called (meaning the path guard
// passed) without needing an exists() mock — the TOCTOU fix removed that call.
// ---------------------------------------------------------------------------

const { mockFileFactory } = vi.hoisted(() => ({
  mockFileFactory: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: vi.fn().mockImplementation(() => ({
      bucket: vi.fn().mockReturnValue({
        file: mockFileFactory,
      }),
    })),
    File: vi.fn(),
  };
});

const PRIVATE_DIR = "/test-bucket/private";

beforeEach(() => {
  vi.stubEnv("PRIVATE_OBJECT_DIR", PRIVATE_DIR);
  mockFileFactory.mockClear();
  // Return a sentinel File-like object so callers can inspect the result.
  mockFileFactory.mockReturnValue({ __mockFile: true });
});

function makeService(): ObjectStorageService {
  return new ObjectStorageService();
}

// ---------------------------------------------------------------------------
// Helper: assert that getObjectEntityFile throws ObjectNotFoundError for the
// given path WITHOUT contacting the GCS client (path guard fires first).
// ---------------------------------------------------------------------------
async function expectTraversalRejected(objectPath: string): Promise<void> {
  const svc = makeService();
  await expect(svc.getObjectEntityFile(objectPath)).rejects.toBeInstanceOf(
    ObjectNotFoundError,
  );
  // The GCS client must not have been contacted — guard fired before file().
  expect(mockFileFactory).not.toHaveBeenCalled();
}

// ---------------------------------------------------------------------------
// Suite 1: Percent-encoded dot-dot traversal
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — percent-encoded dot-dot", () => {
  it("rejects lowercase %2e%2e", async () => {
    await expectTraversalRejected("/objects/%2e%2e/secret");
  });

  it("rejects uppercase %2E%2E", async () => {
    await expectTraversalRejected("/objects/%2E%2E/secret");
  });

  it("rejects mixed case %2e%2E", async () => {
    await expectTraversalRejected("/objects/%2e%2E/secret");
  });

  it("rejects chained encoded traversal: valid/%2e%2e/%2e%2e/escape", async () => {
    await expectTraversalRejected("/objects/valid/%2e%2e/%2e%2e/escape");
  });

  it("rejects %2f-encoded slash combined with dots: ..%2f..", async () => {
    await expectTraversalRejected("/objects/..%2f../escape");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Absolute path injection
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — absolute path injection", () => {
  it("rejects a path starting with /objects//", async () => {
    await expectTraversalRejected("/objects//absolute");
  });

  it("rejects %2f-leading to absolute: /objects/%2fetc%2fpasswd", async () => {
    await expectTraversalRejected("/objects/%2fetc%2fpasswd");
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Dot-only and double-dot literal segments
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — dot-only and double-dot literals", () => {
  it("rejects /objects/. (dot-only normalizes to '.')", async () => {
    await expectTraversalRejected("/objects/.");
  });

  it("rejects /objects/..", async () => {
    await expectTraversalRejected("/objects/..");
  });

  it("rejects /objects/../secret (literal double-dot traversal)", async () => {
    await expectTraversalRejected("/objects/../secret");
  });

  it("rejects /objects/valid/../../../escape", async () => {
    await expectTraversalRejected("/objects/valid/../../../escape");
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Double percent-encoding (%252e → decodes to %2e → then to .)
// After one decodeURIComponent pass: "%2e%2e" (literal percent-encoded string).
// posix.normalize treats that as a safe path segment (no ".." after single
// decode), so the path guard passes and the GCS file factory IS called.
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — double percent-encoding", () => {
  it("passes the path guard for %252e%252e (one-decode gives literal %2e%2e, not ..)", async () => {
    const svc = makeService();
    // The path guard does not fire; getObjectEntityFile returns the File handle.
    const file = await svc.getObjectEntityFile("/objects/%252e%252e/safe");
    expect(file).toBeDefined();
    // GCS file factory was reached (guard passed).
    expect(mockFileFactory).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Malformed percent-encoding
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — malformed percent-encoding", () => {
  it("rejects a path with truncated percent sequence (%2)", async () => {
    await expectTraversalRejected("/objects/%2");
  });

  it("passes the path guard for null-byte injection (%00) — file handle returned", async () => {
    // %00 decodes to NUL byte. posix.normalize leaves it in the segment.
    // The resulting entityId is not ".." so the guard does NOT fire.
    // getObjectEntityFile returns the File handle; the caller will receive a
    // GCS error if the object does not actually exist.
    const svc = makeService();
    const file = await svc.getObjectEntityFile("/objects/file%00.json");
    expect(file).toBeDefined();
    expect(mockFileFactory).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Valid paths — guard must NOT reject, file handle returned
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — valid paths return the GCS File handle", () => {
  it("returns a File handle for a plain UUID-style objectId", async () => {
    const svc = makeService();
    const file = await svc.getObjectEntityFile(
      "/objects/uploads/550e8400-e29b-41d4-a716-446655440000",
    );
    expect(file).toBeDefined();
    expect(mockFileFactory).toHaveBeenCalled();
  });

  it("returns a File handle for a nested valid path (subfolder/filename)", async () => {
    const svc = makeService();
    const file = await svc.getObjectEntityFile(
      "/objects/uploads/subfolder/data.bag",
    );
    expect(file).toBeDefined();
    expect(mockFileFactory).toHaveBeenCalled();
  });

  it("returns a File handle even when the underlying object does not exist (TOCTOU-free)", async () => {
    // No existence pre-check: getObjectEntityFile succeeds for a valid path
    // regardless of whether the object exists in GCS. The caller performs the
    // actual I/O (stream / delete / ACL set) and handles GCS 404 there.
    const svc = makeService();
    const file = await svc.getObjectEntityFile("/objects/uploads/missing-file.csv");
    expect(file).toBeDefined();
    expect(mockFileFactory).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Wrong path prefix
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — wrong path prefix is rejected immediately", () => {
  it("rejects paths that don't start with /objects/", async () => {
    const svc = makeService();
    await expect(
      svc.getObjectEntityFile("/uploads/some-file"),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(mockFileFactory).not.toHaveBeenCalled();
  });

  it("rejects empty string path", async () => {
    const svc = makeService();
    await expect(svc.getObjectEntityFile("")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    expect(mockFileFactory).not.toHaveBeenCalled();
  });
});

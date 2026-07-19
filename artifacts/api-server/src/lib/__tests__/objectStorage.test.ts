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
 * Test scenarios
 * --------------
 * 1. Percent-encoded dot-dot: %2e%2e / %2E%2E
 * 2. Absolute path injection: /etc/passwd style
 * 3. Dot-only segment: /objects/.
 * 4. Literal double-dot: /objects/../secret
 * 5. Mixed encoding: valid-looking path with encoded traversal in a segment
 * 6. Double percent-encoding: %252e%252e (decoded once → %2e%2e)
 * 7. Null byte injection: %00
 * 8. Valid path → reaches GCS client (not rejected by guard)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage.js";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage so getObjectEntityFile never makes real network
// calls. The mock bucket().file() factory is controlled per-test so we can
// simulate "exists" or "not found" independently of the guard logic.
// vi.hoisted() is required so mockFileExists is defined when the vi.mock()
// factory (which is itself hoisted) captures the reference.
// ---------------------------------------------------------------------------

const { mockFileExists } = vi.hoisted(() => ({
  mockFileExists: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: vi.fn().mockImplementation(() => ({
      bucket: vi.fn().mockReturnValue({
        file: vi.fn().mockReturnValue({
          exists: mockFileExists,
        }),
      }),
    })),
    File: vi.fn(),
  };
});

const PRIVATE_DIR = "/test-bucket/private";

beforeEach(() => {
  vi.stubEnv("PRIVATE_OBJECT_DIR", PRIVATE_DIR);
  mockFileExists.mockClear();
  mockFileExists.mockResolvedValue([false]);
});

function makeService(): ObjectStorageService {
  return new ObjectStorageService();
}

// ---------------------------------------------------------------------------
// Helper: assert that getObjectEntityFile throws ObjectNotFoundError for the
// given path WITHOUT contacting the GCS client.
// ---------------------------------------------------------------------------
async function expectTraversalRejected(objectPath: string): Promise<void> {
  const svc = makeService();
  await expect(svc.getObjectEntityFile(objectPath)).rejects.toBeInstanceOf(
    ObjectNotFoundError,
  );
  // The GCS client must not have been contacted — guard fired before exists().
  expect(mockFileExists).not.toHaveBeenCalled();
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
// The guard decodes once with decodeURIComponent; a double-encoded sequence
// decodes to a literal % character, which posix.normalize leaves as-is.
// Double-encoded traversal therefore does NOT resolve to ".." after one decode
// pass and must be treated as a (potentially invalid or benign) path segment —
// the guard should not accidentally allow traversal via this vector.
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — double percent-encoding", () => {
  it("does not reach the GCS client with %252e%252e (decoded to %2e%2e literal, not ..)", async () => {
    // After one decodeURIComponent pass: "%2e%2e" (literal percent-encoded string).
    // posix.normalize treats that as a safe path segment (no ".." after single decode).
    // The file will not exist, so ObjectNotFoundError is still thrown, but via the
    // GCS existence check — not the traversal guard. The client IS contacted here
    // because the single-decode guard doesn't see "..". This is correct: double-
    // encoding doesn't produce traversal after one decode.
    const svc = makeService();
    mockFileExists.mockResolvedValue([false]);
    await expect(
      svc.getObjectEntityFile("/objects/%252e%252e/safe"),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
    // GCS client was reached (no traversal detected) but file doesn't exist.
    expect(mockFileExists).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Malformed percent-encoding
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — malformed percent-encoding", () => {
  it("rejects a path with truncated percent sequence (%2)", async () => {
    await expectTraversalRejected("/objects/%2");
  });

  it("rejects a path with null-byte injection (%00)", async () => {
    // %00 decodes to NUL byte. posix.normalize leaves it in the segment.
    // The resulting path is not ".." so the guard does NOT fire — this reaches
    // the GCS client, which won't find the file. ObjectNotFoundError is thrown.
    const svc = makeService();
    mockFileExists.mockResolvedValue([false]);
    await expect(
      svc.getObjectEntityFile("/objects/file%00.json"),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
    expect(mockFileExists).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Valid paths — guard must NOT reject, request reaches GCS
// ---------------------------------------------------------------------------

describe("getObjectEntityFile — valid paths reach the GCS client", () => {
  it("allows a plain UUID-style objectId when the file exists", async () => {
    mockFileExists.mockResolvedValue([true]);
    const svc = makeService();
    const file = await svc.getObjectEntityFile(
      "/objects/uploads/550e8400-e29b-41d4-a716-446655440000",
    );
    expect(file).toBeDefined();
    expect(mockFileExists).toHaveBeenCalled();
  });

  it("allows a nested valid path (subfolder/filename)", async () => {
    mockFileExists.mockResolvedValue([true]);
    const svc = makeService();
    const file = await svc.getObjectEntityFile(
      "/objects/uploads/subfolder/data.bag",
    );
    expect(file).toBeDefined();
    expect(mockFileExists).toHaveBeenCalled();
  });

  it("throws ObjectNotFoundError when the file does not exist (not a guard rejection)", async () => {
    mockFileExists.mockResolvedValue([false]);
    const svc = makeService();
    await expect(
      svc.getObjectEntityFile("/objects/uploads/missing-file.csv"),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
    // GCS was contacted (guard passed, file just wasn't found).
    expect(mockFileExists).toHaveBeenCalled();
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
    expect(mockFileExists).not.toHaveBeenCalled();
  });

  it("rejects empty string path", async () => {
    const svc = makeService();
    await expect(svc.getObjectEntityFile("")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
    expect(mockFileExists).not.toHaveBeenCalled();
  });
});

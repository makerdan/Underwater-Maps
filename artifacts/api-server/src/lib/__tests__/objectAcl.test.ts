/**
 * objectAcl.test.ts — unit tests for the GCS object ACL helpers.
 *
 * Tests cover:
 *  - public object   → any caller (no userId) can READ
 *  - public object   → WRITE is still denied for anonymous callers
 *  - private object  → owner can READ and WRITE
 *  - private object  → a stranger (different userId) is denied READ
 *  - no policy       → access is denied
 *  - ACL rule with READ permission → matching group member is allowed READ
 *  - ACL rule with READ permission → non-member is denied
 *  - ACL rule with WRITE permission → grants READ to member (WRITE ⊇ READ)
 *  - ACL rule with WRITE permission → does not grant READ to a non-member
 *  - setObjectAclPolicy → serialises policy under the expected GCS metadata key
 *  - setObjectAclPolicy → throws when the object does not exist
 *  - getObjectAclPolicy → deserialises and returns the stored policy
 *  - getObjectAclPolicy → returns null when no metadata is present
 *  - createObjectAccessGroup → returns a DatasetViewersAccessGroup for DATASET_VIEWERS
 *  - createObjectAccessGroup → throws for an unknown group type
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canAccessObject,
  setObjectAclPolicy,
  getObjectAclPolicy,
  createObjectAccessGroup,
  DatasetViewersAccessGroup,
  ObjectPermission,
  ObjectAccessGroupType,
} from "../objectAcl.js";
import type { ObjectAclPolicy } from "../objectAcl.js";

// ---------------------------------------------------------------------------
// GCS File stub factory — builds the minimal subset of the GCS File interface
// that our ACL helpers rely on.
// ---------------------------------------------------------------------------

function makeGcsFile(opts: {
  exists?: boolean;
  metadata?: Record<string, unknown>;
}): import("@google-cloud/storage").File {
  const existsResult: [boolean] = [opts.exists ?? true];
  const metadataResult: [Record<string, unknown>] = [
    opts.metadata ? { metadata: opts.metadata } : {},
  ];
  return {
    name: "test/object.json",
    exists: vi.fn().mockResolvedValue(existsResult),
    getMetadata: vi.fn().mockResolvedValue(metadataResult),
    setMetadata: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@google-cloud/storage").File;
}

function policyMetadata(policy: ObjectAclPolicy) {
  return { "custom:aclPolicy": JSON.stringify(policy) };
}

// ---------------------------------------------------------------------------
// canAccessObject
// ---------------------------------------------------------------------------

describe("canAccessObject — public object", () => {
  it("allows READ for an anonymous caller (no userId)", async () => {
    const file = makeGcsFile({
      metadata: policyMetadata({ owner: "owner-1", visibility: "public" }),
    });
    const result = await canAccessObject({
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("denies WRITE for an anonymous caller on a public object", async () => {
    const file = makeGcsFile({
      metadata: policyMetadata({ owner: "owner-1", visibility: "public" }),
    });
    const result = await canAccessObject({
      objectFile: file,
      requestedPermission: ObjectPermission.WRITE,
    });
    expect(result).toBe(false);
  });

  it("allows READ for any authenticated user on a public object", async () => {
    const file = makeGcsFile({
      metadata: policyMetadata({ owner: "owner-1", visibility: "public" }),
    });
    const result = await canAccessObject({
      userId: "stranger-99",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });
});

describe("canAccessObject — private object", () => {
  it("allows READ and WRITE for the owner", async () => {
    const policy: ObjectAclPolicy = { owner: "owner-1", visibility: "private" };
    const fileRead = makeGcsFile({ metadata: policyMetadata(policy) });
    const fileWrite = makeGcsFile({ metadata: policyMetadata(policy) });

    expect(
      await canAccessObject({ userId: "owner-1", objectFile: fileRead, requestedPermission: ObjectPermission.READ }),
    ).toBe(true);
    expect(
      await canAccessObject({ userId: "owner-1", objectFile: fileWrite, requestedPermission: ObjectPermission.WRITE }),
    ).toBe(true);
  });

  it("denies READ to a stranger on a private object", async () => {
    const file = makeGcsFile({
      metadata: policyMetadata({ owner: "owner-1", visibility: "private" }),
    });
    const result = await canAccessObject({
      userId: "stranger-99",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });

  it("denies READ to an anonymous caller on a private object", async () => {
    const file = makeGcsFile({
      metadata: policyMetadata({ owner: "owner-1", visibility: "private" }),
    });
    const result = await canAccessObject({
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});

describe("canAccessObject — no policy", () => {
  it("denies access when the object has no ACL policy metadata", async () => {
    const file = makeGcsFile({ metadata: {} });
    const result = await canAccessObject({
      userId: "any-user",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});

describe("canAccessObject — ACL rules (group membership)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("allows READ to a group member when the rule grants READ", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-1",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "dataset-abc" },
          permission: ObjectPermission.READ,
        },
      ],
    };
    const file = makeGcsFile({ metadata: policyMetadata(policy) });

    vi.spyOn(DatasetViewersAccessGroup.prototype, "hasMember").mockResolvedValue(true);

    const result = await canAccessObject({
      userId: "viewer-1",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("denies READ to a non-member even when a READ rule exists", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-1",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "dataset-abc" },
          permission: ObjectPermission.READ,
        },
      ],
    };
    const file = makeGcsFile({ metadata: policyMetadata(policy) });

    vi.spyOn(DatasetViewersAccessGroup.prototype, "hasMember").mockResolvedValue(false);

    const result = await canAccessObject({
      userId: "stranger-77",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });

  it("allows READ to a group member when the rule grants WRITE (WRITE ⊇ READ)", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-1",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "dataset-abc" },
          permission: ObjectPermission.WRITE,
        },
      ],
    };
    const file = makeGcsFile({ metadata: policyMetadata(policy) });

    vi.spyOn(DatasetViewersAccessGroup.prototype, "hasMember").mockResolvedValue(true);

    const result = await canAccessObject({
      userId: "editor-1",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("denies READ when the WRITE rule's group does not include the caller", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-1",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "dataset-abc" },
          permission: ObjectPermission.WRITE,
        },
      ],
    };
    const file = makeGcsFile({ metadata: policyMetadata(policy) });

    vi.spyOn(DatasetViewersAccessGroup.prototype, "hasMember").mockResolvedValue(false);

    const result = await canAccessObject({
      userId: "stranger-77",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setObjectAclPolicy
// ---------------------------------------------------------------------------

describe("setObjectAclPolicy", () => {
  it("calls setMetadata with the policy serialised under the expected key", async () => {
    const policy: ObjectAclPolicy = { owner: "owner-1", visibility: "public" };
    const file = makeGcsFile({ exists: true });

    await setObjectAclPolicy(file, policy);

    expect(file.setMetadata).toHaveBeenCalledWith({
      metadata: {
        "custom:aclPolicy": JSON.stringify(policy),
      },
    });
  });

  it("throws when the GCS object does not exist", async () => {
    const file = makeGcsFile({ exists: false });
    const policy: ObjectAclPolicy = { owner: "owner-1", visibility: "private" };

    await expect(setObjectAclPolicy(file, policy)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ---------------------------------------------------------------------------
// getObjectAclPolicy
// ---------------------------------------------------------------------------

describe("getObjectAclPolicy", () => {
  it("deserialises and returns the stored policy", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-1",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "ds-1" },
          permission: ObjectPermission.READ,
        },
      ],
    };
    const file = makeGcsFile({ metadata: policyMetadata(policy) });

    const result = await getObjectAclPolicy(file);
    expect(result).toEqual(policy);
  });

  it("returns null when no ACL policy key is present in metadata", async () => {
    const file = makeGcsFile({ metadata: {} });
    const result = await getObjectAclPolicy(file);
    expect(result).toBeNull();
  });

  it("setObjectAclPolicy → getObjectAclPolicy round-trip preserves the policy intact", async () => {
    const policy: ObjectAclPolicy = {
      owner: "owner-round-trip",
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.DATASET_VIEWERS, id: "ds-rt" },
          permission: ObjectPermission.WRITE,
        },
      ],
    };

    let storedMetadata: Record<string, unknown> = {};

    const file = {
      name: "test/rt.json",
      exists: vi.fn().mockResolvedValue([true]),
      setMetadata: vi.fn().mockImplementation((m: { metadata: Record<string, unknown> }) => {
        storedMetadata = m.metadata;
        return Promise.resolve();
      }),
      getMetadata: vi.fn().mockImplementation(() => Promise.resolve([{ metadata: storedMetadata }])),
    } as unknown as import("@google-cloud/storage").File;

    await setObjectAclPolicy(file, policy);
    const retrieved = await getObjectAclPolicy(file);
    expect(retrieved).toEqual(policy);
  });
});

// ---------------------------------------------------------------------------
// createObjectAccessGroup / DatasetViewersAccessGroup
// ---------------------------------------------------------------------------

describe("createObjectAccessGroup", () => {
  it("returns a DatasetViewersAccessGroup for DATASET_VIEWERS", () => {
    const group = createObjectAccessGroup({
      type: ObjectAccessGroupType.DATASET_VIEWERS,
      id: "dataset-xyz",
    });
    expect(group).toBeInstanceOf(DatasetViewersAccessGroup);
    expect(group.id).toBe("dataset-xyz");
    expect(group.type).toBe(ObjectAccessGroupType.DATASET_VIEWERS);
  });

  it("throws for an unrecognised group type", () => {
    expect(() =>
      createObjectAccessGroup({
        type: "UNKNOWN_TYPE" as ObjectAccessGroupType,
        id: "x",
      }),
    ).toThrow(/Unknown access group type/);
  });
});

describe("DatasetViewersAccessGroup.hasMember", () => {
  it("returns false by default (no grant table yet)", async () => {
    const group = new DatasetViewersAccessGroup("dataset-123");
    const result = await group.hasMember("any-user");
    expect(result).toBe(false);
  });
});

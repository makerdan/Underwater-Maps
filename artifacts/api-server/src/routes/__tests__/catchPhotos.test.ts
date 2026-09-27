import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const storageState = vi.hoisted(() => {
  class MockObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }

  const objects = new Map<
    string,
    { owner: string; body: Buffer; contentType: string }
  >();
  const downloadObject = vi.fn();

  process.env["E2E_AUTH_BYPASS"] = "1";

  return {
    MockObjectNotFoundError,
    objects,
    downloadObject,
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("../../lib/objectStorage.js", () => ({
  ObjectNotFoundError: storageState.MockObjectNotFoundError,
  ObjectStorageService: class {
    async getObjectEntityFile(objectPath: string) {
      const object = storageState.objects.get(objectPath);
      if (!object) {
        throw new storageState.MockObjectNotFoundError();
      }
      return object;
    }

    async canAccessObjectEntity({
      userId,
      objectFile,
    }: {
      userId?: string;
      objectFile: { owner: string };
    }) {
      return userId === objectFile.owner;
    }

    async downloadObject(objectFile: {
      body: Buffer;
      contentType: string;
    }) {
      storageState.downloadObject(objectFile);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(objectFile.body));
          controller.close();
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": objectFile.contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  },
}));

import objectsRouter from "../objects.js";

const PRIVATE_PHOTO_PATH = "/objects/catch-photos/owner/photo.jpg";
const OWNER_ID = "catch-owner";
const OTHER_USER_ID = "different-user";
const PHOTO_BYTES = Buffer.from("private catch photo fixture");

function makeApp() {
  const app = express();
  app.use("/api", objectsRouter);
  return app;
}

function authenticatedPhotoRequest(userId: string) {
  return request(makeApp())
    .get("/api" + PRIVATE_PHOTO_PATH)
    .set("x-e2e-user-id", userId)
    .set("x-e2e-bypass-secret", "vitest-test-secret");
}

describe("private catch photo object access", () => {
  beforeEach(() => {
    storageState.objects.clear();
    storageState.downloadObject.mockClear();
    storageState.objects.set(PRIVATE_PHOTO_PATH, {
      owner: OWNER_ID,
      body: PHOTO_BYTES,
      contentType: "image/jpeg",
    });
  });

  it("lets the authenticated owner retrieve their permitted catch photo", async () => {
    const response = await authenticatedPhotoRequest(OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(response.body).toEqual(PHOTO_BYTES);
    expect(storageState.downloadObject).toHaveBeenCalledOnce();
  });

  it("forbids another authenticated user without revealing the photo", async () => {
    const response = await authenticatedPhotoRequest(OTHER_USER_ID);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "forbidden",
      details: "You do not have access to this object",
    });
    expect(storageState.downloadObject).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access before consulting the object", async () => {
    const response = await request(makeApp()).get("/api" + PRIVATE_PHOTO_PATH);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(storageState.downloadObject).not.toHaveBeenCalled();
  });

  it("keeps missing private objects indistinguishable from other missing objects", async () => {
    storageState.objects.clear();

    const response = await authenticatedPhotoRequest(OTHER_USER_ID);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "not_found",
      details: "Object not found",
    });
    expect(JSON.stringify(response.body)).not.toContain(OWNER_ID);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE_PHOTO_PATH);
    expect(storageState.downloadObject).not.toHaveBeenCalled();
  });
});
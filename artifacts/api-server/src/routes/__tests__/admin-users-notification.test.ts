/**
 * Admin SMTP test-notification endpoint coverage.
 *
 * The mail helper is mocked here; its live SMTP behavior is covered in
 * lib/__tests__/adminEmail.test.ts. These checks focus on the route's shared
 * requireAuth + isAdmin gates and its transparent result response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { sendAdminTestNotificationMock } = vi.hoisted(() => ({
  sendAdminTestNotificationMock: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  userAccessTable: {},
}));

vi.mock("../../lib/adminEmail.js", () => ({
  sendAdminTestNotification: sendAdminTestNotificationMock,
}));

import adminUsersRouter from "../admin-users.js";

const ADMIN_ID = "user_admin_notification_test";

function makeApp() {
  const app = express();
  app.use(adminUsersRouter);
  return app;
}

function authenticatedPost(userId: string) {
  return request(makeApp())
    .post("/admin/users/test-notification")
    .set("x-e2e-bypass-secret", "vitest-test-secret")
    .set("x-e2e-user-id", userId);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("E2E_BYPASS_SECRET", "vitest-test-secret");
  vi.stubEnv("BUCKET_MONITOR_ADMIN", "0");
  vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
});

describe("POST /admin/users/test-notification", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");

    const res = await request(makeApp()).post("/admin/users/test-notification");

    expect(res.status).toBe(401);
    expect(sendAdminTestNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 403 without sending when the caller is not an admin", async () => {
    const res = await authenticatedPost("user_not_an_admin");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
    expect(sendAdminTestNotificationMock).not.toHaveBeenCalled();
  });

  it("returns a successful SMTP send result to an admin", async () => {
    sendAdminTestNotificationMock.mockResolvedValue({ sent: true, recipientCount: 2 });

    const res = await authenticatedPost(ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, recipientCount: 2 });
    expect(sendAdminTestNotificationMock).toHaveBeenCalledOnce();
  });

  it("returns an SMTP failure result to an admin", async () => {
    sendAdminTestNotificationMock.mockResolvedValue({
      sent: false,
      reason: "SMTP is not configured",
    });

    const res = await authenticatedPost(ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false, reason: "SMTP is not configured" });
  });
});
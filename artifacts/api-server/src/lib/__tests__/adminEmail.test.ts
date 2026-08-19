/**
 * adminEmail.test.ts — unit tests for best-effort admin email notifications.
 *
 * Covers:
 *   - readSmtpConfig: present / absent / partial configs
 *   - fetchAdminEmails: resolves admin Clerk profiles, swallows individual failures
 *   - notifyAdminsNewPendingUser:
 *       - skips when SMTP not configured
 *       - skips when no admin emails resolve
 *       - sends via nodemailer when fully configured
 *       - email body contains name, email, user ID, approval link
 *       - swallows transport errors (never throws)
 *       - APP_BASE_URL absent → text fallback, no href link
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { clerkGetUserMock, sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: "test-msg-id" }));
  const createTransport = vi.fn(() => ({ sendMail }));
  const clerkGetUser = vi.fn();
  return { clerkGetUserMock: clerkGetUser, sendMailMock: sendMail, createTransportMock: createTransport };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: clerkGetUserMock } },
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  readSmtpConfig,
  fetchAdminEmails,
  notifyAdminsNewPendingUser,
  sendAdminTestNotification,
} from "../adminEmail.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClerkUser(email: string | null, firstName = "Test", lastName = "Admin") {
  return {
    emailAddresses: email ? [{ emailAddress: email }] : [],
    firstName,
    lastName,
    username: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// readSmtpConfig
// ---------------------------------------------------------------------------

describe("readSmtpConfig", () => {
  it("returns null when SMTP_HOST is absent", () => {
    vi.stubEnv("SMTP_USER", "user@example.com");
    vi.stubEnv("SMTP_PASS", "secret");
    expect(readSmtpConfig()).toBeNull();
  });

  it("returns null when SMTP_USER is absent", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_PASS", "secret");
    expect(readSmtpConfig()).toBeNull();
  });

  it("returns null when SMTP_PASS is absent", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "user@example.com");
    expect(readSmtpConfig()).toBeNull();
  });

  it("returns config with defaults when all required vars are set", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "user@example.com");
    vi.stubEnv("SMTP_PASS", "secret");
    const cfg = readSmtpConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.host).toBe("smtp.example.com");
    expect(cfg!.port).toBe(587); // default
    expect(cfg!.secure).toBe(false); // default
    expect(cfg!.from).toBe("user@example.com"); // defaults to SMTP_USER
  });

  it("respects SMTP_PORT, SMTP_SECURE, and SMTP_FROM overrides", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "user@example.com");
    vi.stubEnv("SMTP_PASS", "secret");
    vi.stubEnv("SMTP_PORT", "465");
    vi.stubEnv("SMTP_SECURE", "true");
    vi.stubEnv("SMTP_FROM", "noreply@bathyscan.app");
    const cfg = readSmtpConfig();
    expect(cfg!.port).toBe(465);
    expect(cfg!.secure).toBe(true);
    expect(cfg!.from).toBe("noreply@bathyscan.app");
  });

  it("ignores non-numeric SMTP_PORT and falls back to 587", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    vi.stubEnv("SMTP_PORT", "not-a-number");
    expect(readSmtpConfig()!.port).toBe(587);
  });
});

// ---------------------------------------------------------------------------
// fetchAdminEmails
// ---------------------------------------------------------------------------

describe("fetchAdminEmails", () => {
  it("returns an empty array when ADMIN_USER_IDS is unset", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    const emails = await fetchAdminEmails();
    expect(emails).toEqual([]);
    expect(clerkGetUserMock).not.toHaveBeenCalled();
  });

  it("resolves email addresses for each admin ID", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1,user_admin2");
    clerkGetUserMock.mockImplementation((id: string) =>
      Promise.resolve(makeClerkUser(id === "user_admin1" ? "admin1@example.com" : "admin2@example.com")),
    );
    const emails = await fetchAdminEmails();
    expect(emails).toContain("admin1@example.com");
    expect(emails).toContain("admin2@example.com");
  });

  it("skips an admin whose Clerk lookup fails", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_good,user_bad");
    clerkGetUserMock.mockImplementation((id: string) => {
      if (id === "user_bad") return Promise.reject(new Error("Clerk 404"));
      return Promise.resolve(makeClerkUser("good@example.com"));
    });
    const emails = await fetchAdminEmails();
    expect(emails).toEqual(["good@example.com"]);
  });

  it("skips an admin who has no primary email address", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_noemail");
    clerkGetUserMock.mockResolvedValue(makeClerkUser(null));
    const emails = await fetchAdminEmails();
    expect(emails).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// notifyAdminsNewPendingUser
// ---------------------------------------------------------------------------

function stubSmtp() {
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_USER", "bot@example.com");
  vi.stubEnv("SMTP_PASS", "secret");
  vi.stubEnv("SMTP_FROM", "noreply@bathyscan.app");
}

const PENDING_USER = {
  clerkUserId: "user_2pending",
  displayName: "Test Angler",
  email: "angler@example.com",
};

describe("notifyAdminsNewPendingUser", () => {
  it("does not call sendMail when SMTP is not configured", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));
    // No SMTP env vars set
    await notifyAdminsNewPendingUser(PENDING_USER);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("does not call sendMail when no admin emails resolve", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", ""); // explicitly empty — no recipients
    await notifyAdminsNewPendingUser(PENDING_USER);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("calls sendMail with the correct recipients and envelope when fully configured", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    vi.stubEnv("APP_BASE_URL", "https://app.bathyscan.example");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));

    await notifyAdminsNewPendingUser(PENDING_USER);

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "bot@example.com", pass: "secret" },
      }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, unknown>;
    expect(call.from).toBe("noreply@bathyscan.app");
    expect(call.to).toContain("admin@example.com");
    expect(typeof call.subject).toBe("string");
    expect((call.subject as string).toLowerCase()).toMatch(/approval|pending|waiting/i);
  });

  it("email body contains user display name, email, and user ID", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));

    await notifyAdminsNewPendingUser(PENDING_USER);

    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.text).toContain("Test Angler");
    expect(call.text).toContain("angler@example.com");
    expect(call.text).toContain("user_2pending");
    expect(call.html).toContain("Test Angler");
    expect(call.html).toContain("angler@example.com");
    expect(call.html).toContain("user_2pending");
  });

  it("email body contains an approval link when APP_BASE_URL is set", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    vi.stubEnv("APP_BASE_URL", "https://app.bathyscan.example");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));

    await notifyAdminsNewPendingUser(PENDING_USER);

    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.text).toContain("https://app.bathyscan.example");
    expect(call.html).toContain("https://app.bathyscan.example");
    expect(call.html).toContain("/settings?tab=account");
  });

  it("email body falls back to text hint when APP_BASE_URL is absent", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));

    await notifyAdminsNewPendingUser(PENDING_USER);

    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.text).toContain("Settings");
    expect(call.text).toContain("Account");
    // No anchor href in the HTML
    expect(call.html).not.toContain('href="http');
  });

  it("handles null displayName and email gracefully", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));

    await notifyAdminsNewPendingUser({
      clerkUserId: "user_2anon",
      displayName: null,
      email: null,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.text).toContain("(no display name)");
    expect(call.text).toContain("(no email)");
  });

  it("swallows transport errors — never throws", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));
    sendMailMock.mockRejectedValue(new Error("SMTP connection refused"));

    await expect(notifyAdminsNewPendingUser(PENDING_USER)).resolves.toBeUndefined();
  });

  it("sends to multiple admins as a comma-separated 'to' field", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_a1,user_a2");
    clerkGetUserMock.mockImplementation((id: string) =>
      Promise.resolve(makeClerkUser(id === "user_a1" ? "admin1@example.com" : "admin2@example.com")),
    );

    await notifyAdminsNewPendingUser(PENDING_USER);

    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.to).toContain("admin1@example.com");
    expect(call.to).toContain("admin2@example.com");
  });
});

describe("sendAdminTestNotification", () => {
  it("reports that SMTP is unconfigured without attempting delivery", async () => {
    const result = await sendAdminTestNotification();

    expect(result).toEqual({ sent: false, reason: "SMTP is not configured" });
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("sends a clearly labelled sample email and returns the recipient count", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1,user_admin2");
    clerkGetUserMock.mockImplementation((id: string) =>
      Promise.resolve(makeClerkUser(`${id}@example.com`)),
    );
    sendMailMock.mockResolvedValue({ messageId: "test-msg-id" });

    await expect(sendAdminTestNotification()).resolves.toEqual({
      sent: true,
      recipientCount: 2,
    });

    const call = (sendMailMock.mock.calls as unknown[][])[0]![0] as Record<string, string>;
    expect(call.subject).toMatch(/test notification/i);
    expect(call.text).toMatch(/test notification/i);
    expect(call.text).toMatch(/no user is waiting/i);
  });

  it("returns a safe failure reason when SMTP delivery rejects", async () => {
    stubSmtp();
    vi.stubEnv("ADMIN_USER_IDS", "user_admin1");
    clerkGetUserMock.mockResolvedValue(makeClerkUser("admin@example.com"));
    sendMailMock.mockRejectedValue(new Error("SMTP connection refused"));

    await expect(sendAdminTestNotification()).resolves.toEqual({
      sent: false,
      reason: "SMTP delivery failed",
    });
  });
});

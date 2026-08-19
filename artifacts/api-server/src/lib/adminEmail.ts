/**
 * adminEmail.ts — Best-effort email notifications for admin events.
 *
 * Currently handles one event: a new pending user is waiting for approval.
 *
 * Transport: nodemailer over SMTP. The feature is entirely opt-in — if
 * SMTP_HOST is not set the function logs a debug line and returns without
 * sending. This keeps existing deployments unaffected until an operator
 * explicitly configures the SMTP env vars.
 *
 * Required env vars (all must be present for sending to occur):
 *   SMTP_HOST   — SMTP server hostname
 *   SMTP_USER   — SMTP login username
 *   SMTP_PASS   — SMTP login password
 *
 * Optional env vars:
 *   SMTP_PORT         — SMTP port (default: 587)
 *   SMTP_SECURE       — "true" to use implicit TLS/SSL (default: false)
 *   SMTP_FROM         — Sender address (default: SMTP_USER)
 *   APP_BASE_URL      — Public URL of the app, used to build the approval link
 *                       (e.g. https://myapp.replit.app). Falls back to an
 *                       unlinked hint when absent.
 */

import nodemailer from "nodemailer";
import { clerkClient } from "@clerk/express";
import { parseAdminUserIds } from "./adminAccess.js";
import { logger } from "./logger.js";

export interface PendingUserInfo {
  clerkUserId: string;
  displayName: string | null;
  email: string | null;
  /** Makes the email explicitly identify itself as an operator test send. */
  isTestNotification?: boolean;
}

export type AdminNotificationSendResult =
  | { sent: true; recipientCount: number }
  | { sent: false; reason: string };

/**
 * Read SMTP configuration from env. Returns null when the minimum required
 * vars (SMTP_HOST, SMTP_USER, SMTP_PASS) are absent.
 */
export function readSmtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
} | null {
  const host = process.env["SMTP_HOST"]?.trim() ?? "";
  const user = process.env["SMTP_USER"]?.trim() ?? "";
  const pass = process.env["SMTP_PASS"]?.trim() ?? "";

  if (!host || !user || !pass) return null;

  const portRaw = process.env["SMTP_PORT"]?.trim() ?? "";
  const port = portRaw && /^\d+$/.test(portRaw) ? parseInt(portRaw, 10) : 587;
  const secure = process.env["SMTP_SECURE"]?.trim().toLowerCase() === "true";
  const from = process.env["SMTP_FROM"]?.trim() || user;

  return { host, port, secure, user, pass, from };
}

/**
 * Fetch Clerk profiles for every admin user ID listed in ADMIN_USER_IDS and
 * return their primary email addresses. Individual lookup failures are caught
 * and logged — the returned list contains only addresses that resolved.
 */
export async function fetchAdminEmails(): Promise<string[]> {
  const adminIds = parseAdminUserIds(process.env["ADMIN_USER_IDS"]);
  if (adminIds.length === 0) return [];

  const clerk = clerkClient;
  const emails: string[] = [];

  await Promise.allSettled(
    adminIds.map(async (adminId) => {
      try {
        const user = await clerk.users.getUser(adminId);
        const email = user.emailAddresses[0]?.emailAddress;
        if (email) emails.push(email);
      } catch (err) {
        logger.warn(
          { adminId, err },
          "[adminEmail] failed to fetch Clerk profile for admin — skipping this recipient",
        );
      }
    }),
  );

  return emails;
}

/**
 * Build the plain-text + HTML bodies for a "new pending user" notification.
 */
function buildNewPendingUserEmail(user: PendingUserInfo): {
  subject: string;
  text: string;
  html: string;
} {
  const name = user.displayName ?? "(no display name)";
  const email = user.email ?? "(no email)";
  const id = user.clerkUserId;

  const appUrl = process.env["APP_BASE_URL"]?.trim().replace(/\/$/, "") ?? "";
  const approvalPath = "/settings?tab=account";
  const approvalUrl = appUrl ? `${appUrl}${approvalPath}` : null;

  const notificationIntro = user.isTestNotification
    ? "This is a test notification. No user is waiting for approval."
    : "A new user has signed in and is waiting for your approval.";
  const subject = user.isTestNotification
    ? "[BathyScan] Test notification: pending-user email delivery"
    : `[BathyScan] New user waiting for approval: ${name}`;

  const text = [
    notificationIntro,
    "",
    `  Name:    ${name}`,
    `  Email:   ${email}`,
    `  User ID: ${id}`,
    "",
    approvalUrl
      ? `Review and approve at: ${approvalUrl}`
      : "To review and approve, open the app and go to Settings → Account.",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#222;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#1a56a0;margin-top:0">New user waiting for approval</h2>
  <p>${notificationIntro}</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;color:#555">Name</td>
      <td style="padding:6px 0">${htmlEscape(name)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;color:#555">Email</td>
      <td style="padding:6px 0">${htmlEscape(email)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;color:#555">User ID</td>
      <td style="padding:6px 0;font-family:monospace;font-size:0.9em">${htmlEscape(id)}</td>
    </tr>
  </table>
  ${
    approvalUrl
      ? `<a href="${htmlEscape(approvalUrl)}"
           style="display:inline-block;background:#1a56a0;color:#fff;text-decoration:none;
                  padding:10px 20px;border-radius:4px;font-weight:bold;margin-top:8px">
           Review &amp; Approve
         </a>`
      : `<p style="margin-top:16px">Open the app and go to <strong>Settings → Account</strong> to review and approve.</p>`
  }
  <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:0.8em;color:#888">
    ${
      user.isTestNotification
        ? "This email was sent by an administrator to verify BathyScan's SMTP delivery."
        : "This email was sent automatically by BathyScan when a new user signed in."
    }
    You are receiving it because you are listed as an admin.
  </p>
</body>
</html>`.trim();

  return { subject, text, html };
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendPendingUserNotification(
  user: PendingUserInfo,
): Promise<AdminNotificationSendResult> {
  try {
    const smtpConfig = readSmtpConfig();
    if (!smtpConfig) {
      logger.debug(
        { clerkUserId: user.clerkUserId },
        "[adminEmail] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) — skipping admin notification",
      );
      return { sent: false, reason: "SMTP is not configured" };
    }

    const recipients = await fetchAdminEmails();
    if (recipients.length === 0) {
      logger.debug(
        { clerkUserId: user.clerkUserId },
        "[adminEmail] no admin email addresses resolved — skipping notification",
      );
      return { sent: false, reason: "No admin email recipients are configured" };
    }

    const transport = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    });

    const { subject, text, html } = buildNewPendingUserEmail(user);

    await transport.sendMail({
      from: smtpConfig.from,
      to: recipients.join(", "),
      subject,
      text,
      html,
    });

    logger.info(
      { clerkUserId: user.clerkUserId, recipientCount: recipients.length },
      "[adminEmail] admin notification sent for new pending user",
    );
    return { sent: true, recipientCount: recipients.length };
  } catch (err) {
    logger.warn(
      { clerkUserId: user.clerkUserId, err },
      "[adminEmail] failed to send admin notification",
    );
    return { sent: false, reason: "SMTP delivery failed" };
  }
}

/**
 * Notify all admins that a new user is waiting for approval.
 *
 * Best-effort: all errors are caught and logged. This function never throws.
 * The caller's response (403 awaiting_approval) is never blocked.
 */
export async function notifyAdminsNewPendingUser(user: PendingUserInfo): Promise<void> {
  await sendPendingUserNotification(user);
}

/**
 * Send a clearly-labelled sample approval email to every configured admin.
 *
 * Unlike the automatic sign-in notification, this result is intended for the
 * admin route so an operator can immediately see whether SMTP was configured
 * and accepted the message.
 */
export async function sendAdminTestNotification(): Promise<AdminNotificationSendResult> {
  return sendPendingUserNotification({
    clerkUserId: "smtp-delivery-test",
    displayName: "SMTP delivery test",
    email: null,
    isTestNotification: true,
  });
}

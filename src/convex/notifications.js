"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

function formatRegistrantName(firstName, surname, userEmail) {
  const fullName = `${String(firstName || "").trim()} ${String(surname || "").trim()}`.trim();
  return fullName || userEmail;
}

export const sendAdminNewUserNotification = internalAction({
  args: {
    recipients: v.array(v.string()),
    userEmail: v.string(),
    firstName: v.string(),
    surname: v.string(),
  },
  handler: async (_ctx, args) => {
    const recipients = Array.from(
      new Set(args.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean))
    );
    if (recipients.length === 0) {
      return { sent: false, reason: "no_recipients" };
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    const appUrl = process.env.APP_BASE_URL || "https://events.selfiebox.co.za";

    if (!resendApiKey || !fromEmail) {
      console.warn("Skipping admin registration email: missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
      return { sent: false, reason: "missing_email_config", recipients };
    }

    const registrantName = formatRegistrantName(args.firstName, args.surname, args.userEmail);
    const subject = `New user registration: ${registrantName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2a44;">
        <h2 style="margin-bottom: 12px;">New registration pending approval</h2>
        <p>A new user has registered for SelfieBox Events and is waiting for approval.</p>
        <p><strong>Name:</strong> ${registrantName}</p>
        <p><strong>Email:</strong> ${args.userEmail}</p>
        <p>Please sign in and approve or activate the user from the Manage Users screen.</p>
        <p><a href="${appUrl}" style="display:inline-block;padding:10px 16px;background:#2e65ff;color:#ffffff;text-decoration:none;border-radius:8px;">Open dashboard</a></p>
      </div>
    `;
    const text = [
      "New registration pending approval",
      "",
      `Name: ${registrantName}`,
      `Email: ${args.userEmail}`,
      "",
      `Open dashboard: ${appUrl}`,
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to send admin registration email: ${response.status} ${body}`);
    }

    const payload = await response.json();
    return { sent: true, recipients, id: payload?.id || null };
  },
});

export const sendTestAdminNotification = action({
  args: {
    recipient: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.runAction(internal.notifications.sendAdminNewUserNotification, {
      recipients: [args.recipient],
      userEmail: "test-user@selfiebox.co.za",
      firstName: "Test",
      surname: "Registration",
    });
  },
});

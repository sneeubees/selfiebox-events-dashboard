// Emails info@ and designs@ when the Server Health page's "Issues detected"
// state (see selfiebox-health.sh: disk >=93%, an app down, or nginx inactive)
// starts, and again when it clears. Called from the /health/ingest http
// action after every 5-minute snapshot - debounced so a persistent issue
// (e.g. disk staying full for days) sends one alert on the state change,
// then at most a daily reminder, not one email per snapshot.

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const ALERT_RECIPIENTS = ["info@selfiebox.co.za", "designs@selfiebox.co.za"];
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function reasonsFromPayload(payload) {
  const reasons = [];
  const diskPct = Number(payload?.diskPct) || 0;
  if (diskPct >= 93) {
    const free = payload?.host?.diskFreeGb;
    reasons.push(`Disk ${diskPct}% full${free != null ? ` (${free} GB free)` : ""}`);
  }
  for (const app of payload?.apps || []) {
    if (app.ok) continue;
    if (app.key === "pdf-extraction") {
      reasons.push("Quote/invoice PDF reader is failing - numbers won't pull through from uploads (automatic restart of the helper was attempted)");
    } else {
      reasons.push(`${app.name} is down (http ${app.httpCode})`);
    }
  }
  const nginx = payload?.host?.nginx;
  if (nginx && nginx !== "active") reasons.push(`nginx is ${nginx}`);
  return reasons.length ? reasons : ["Server Health reported an issue"];
}

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return `${hrs}h ${remMins}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f9;">
  <div style="max-width:600px;margin:0 auto;padding:26px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="padding:6px 4px 18px;">
      <span style="font-size:20px;font-weight:800;color:#14264d;">Selfie</span><span style="font-size:20px;font-weight:800;color:#2f73e6;">Box</span>
      <span style="font-size:12px;color:#7a869c;">&nbsp;&middot; Server Health</span>
    </div>
    ${bodyHtml}
    <div style="font-size:12px;color:#7a869c;line-height:1.6;padding:14px 4px 0;">
      Full status: <a href="https://events.selfiebox.co.za" style="color:#2f73e6;">events.selfiebox.co.za</a> &rarr; Info &amp; Reporting &rarr; Server Health.
    </div>
  </div></body></html>`;
}

function buildAlertEmail({ reasons, isReminder, startedAt, now }) {
  const subject = `${isReminder ? "[Still open] " : ""}SelfieBox server issue: ${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`;
  const li = reasons.map((r) => `<li style="margin:0 0 6px;line-height:1.5;">${esc(r)}</li>`).join("");
  const sinceLine = isReminder
    ? `<div style="font-size:13px;color:#7a869c;margin:0 0 14px;">Ongoing for ${esc(formatDuration(now - startedAt))} - this is a daily reminder while it stays unresolved.</div>`
    : "";
  const body = `
    <div style="padding:16px 18px;background:#fde3e3;border:1px solid #f3b4b4;border-radius:12px;margin:0 0 14px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#c53c3c;font-weight:700;margin-bottom:8px;">Issues detected</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#33415e;">${li}</ul>
    </div>
    ${sinceLine}`;
  const html = shell(subject, body);
  const text = [subject, "", ...reasons.map((r) => `- ${r}`), isReminder ? `\nOngoing for ${formatDuration(now - startedAt)}.` : ""].filter(Boolean).join("\n");
  return { subject, html, text };
}

function buildResolvedEmail({ lastReason, durationMs }) {
  const subject = "SelfieBox server issue resolved";
  const body = `
    <div style="padding:16px 18px;background:#e2f6ea;border:1px solid #bfe3cd;border-radius:12px;margin:0 0 14px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#1d9e57;font-weight:700;margin-bottom:8px;">Back to normal</div>
      <div style="font-size:14px;color:#33415e;line-height:1.6;">All systems operational again. The issue (${esc(lastReason || "see previous alert")}) lasted about ${esc(formatDuration(durationMs))}.</div>
    </div>`;
  const html = shell(subject, body);
  const text = `${subject}\n\nAll systems operational again. The issue (${lastReason || "see previous alert"}) lasted about ${formatDuration(durationMs)}.`;
  return { subject, html, text };
}

async function sendEmail(to, subject, html, text) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "no RESEND_API_KEY" };
  const from = process.env.RESEND_FROM_EMAIL || "SelfieBox <bookings@events.selfiebox.co.za>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "SelfieBox-Convex/1.0" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const body = await resp.text();
  return { sent: resp.ok, status: resp.status, to, body: body.slice(0, 200) };
}

export const getAlertState = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("serverHealthAlertState").first();
  },
});

export const setAlertState = internalMutation({
  args: { state: v.string(), startedAt: v.number(), lastSentAt: v.number(), lastReason: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("serverHealthAlertState").first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("serverHealthAlertState", args);
    }
  },
});

export const checkAndAlert = internalAction({
  args: { ts: v.number(), overallOk: v.boolean(), payload: v.any() },
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.serverHealthAlert.getAlertState, {});
    const wasIssue = state?.state === "issue";
    const now = args.ts;

    if (!args.overallOk) {
      const isReminder = wasIssue;
      const dueForReminder = !wasIssue || now - (state?.lastSentAt || 0) >= REMINDER_INTERVAL_MS;
      if (!dueForReminder) return { action: "skipped_debounced" };

      const reasons = reasonsFromPayload(args.payload);
      const startedAt = wasIssue ? state.startedAt : now;
      const { subject, html, text } = buildAlertEmail({ reasons, isReminder, startedAt, now });
      const result = await sendEmail(ALERT_RECIPIENTS, subject, html, text);
      await ctx.runMutation(internal.serverHealthAlert.setAlertState, {
        state: "issue", startedAt, lastSentAt: now, lastReason: reasons.join("; "),
      });
      return { action: isReminder ? "reminder_sent" : "alert_sent", reasons, result };
    }

    if (wasIssue) {
      const durationMs = now - (state.startedAt || now);
      const { subject, html, text } = buildResolvedEmail({ lastReason: state.lastReason, durationMs });
      const result = await sendEmail(ALERT_RECIPIENTS, subject, html, text);
      await ctx.runMutation(internal.serverHealthAlert.setAlertState, {
        state: "ok", startedAt: 0, lastSentAt: now, lastReason: "",
      });
      return { action: "resolved_sent", result };
    }

    return { action: "none" };
  },
});

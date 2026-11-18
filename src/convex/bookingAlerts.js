// Emails info@ when a confirmed booking (In Progress / Event Completed) is moved
// to any other status - except the normal step forward, In Progress -> Event
// Completed - and whenever a booking is deleted. Scheduled from events.upsert and
// events.remove so every path that saves a status or deletes a row is covered.
// Added after SACAP CT (16 Nov 2026) was deleted by mistake and nobody noticed
// until the event day.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const ALERT_RECIPIENTS = ["info@selfiebox.co.za"];

// Bookings in these statuses are confirmed: they can't be deleted, and moving
// them anywhere but forward sends an alert.
export const CONFIRMED_STATUSES = ["In Progress", "Event Completed"];

export function isConfirmedStatus(status) {
  return CONFIRMED_STATUSES.includes(String(status || "").trim());
}

export function isStatusRevert(fromStatus, toStatus) {
  const from = String(fromStatus || "").trim();
  const to = String(toStatus || "").trim();
  if (!isConfirmedStatus(from) || from === to) return false;
  return !(from === "In Progress" && to === "Event Completed");
}

// The booking fields the email shows, taken from an events row.
export function bookingAlertSummary(record) {
  return {
    name: record.name || "Untitled event",
    eventTitle: record.eventTitle || "",
    date: record.date || "",
    branch: (record.branch || []).join(", "),
    products: (record.products || []).join(", "),
    location: record.location || "",
    status: record.status || "",
    quoteNumber: record.quoteNumber || "",
    invoiceNumber: record.invoiceNumber || "",
    linked: Boolean(record.bookingGroupId),
  };
}

export async function scheduleBookingAlert(ctx, alert) {
  await ctx.scheduler.runAfter(0, internal.bookingAlerts.sendBookingAlert, alert);
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatEventDate(isoDate) {
  if (!isoDate) return "No date";
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatSast(ms) {
  return new Date(ms).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function buildEmail(alert) {
  const b = alert.booking;
  const where = [formatEventDate(b.date), b.branch].filter(Boolean).join(", ");
  const isDelete = alert.kind === "deleted";
  const subject = isDelete
    ? `Booking deleted: ${b.name} (${where})`
    : `Booking moved back: ${b.name} (${where}) ${alert.fromStatus} → ${alert.toStatus}`;
  const headline = isDelete
    ? `${esc(alert.actorName)} deleted this booking. It was <strong>${esc(b.status || "no status")}</strong>.`
    : `${esc(alert.actorName)} changed the status from <strong>${esc(alert.fromStatus)}</strong> to <strong>${esc(alert.toStatus || "no status")}</strong>.`;
  const rows = [
    ["Client", b.name],
    ["Event name", b.eventTitle],
    ["Date", formatEventDate(b.date)],
    ["Branch", b.branch],
    ["Products", b.products],
    ["Location", b.location],
    ["Quote", b.quoteNumber],
    ["Invoice", b.invoiceNumber],
    [isDelete ? "Deleted by" : "Changed by", alert.actorName],
    ["When", formatSast(alert.at)],
  ].filter(([, value]) => value);
  if (alert.linkedRowsChanged) rows.push(["Linked rows", `Also applied to ${alert.linkedRowsChanged} linked row${alert.linkedRowsChanged === 1 ? "" : "s"}`]);
  else if (b.linked) rows.push(["Linked rows", isDelete ? "This was one row of a linked booking" : "Only this row of a linked booking"]);
  const tableRows = rows.map(([label, value]) => `<tr><td style="padding:5px 12px 5px 0;color:#7a869c;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(label)}</td><td style="padding:5px 0;color:#14264d;font-size:14px;">${esc(value)}</td></tr>`).join("");
  const footer = isDelete
    ? "Deleted bookings can be restored from the daily backup. Ask Johan if this was a mistake."
    : "If this was a mistake, set the status back on the dashboard.";
  const appUrl = process.env.APP_BASE_URL || "https://events.selfiebox.co.za";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f9;">
  <div style="max-width:600px;margin:0 auto;padding:26px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="padding:6px 4px 18px;">
      <span style="font-size:20px;font-weight:800;color:#14264d;">Selfie</span><span style="font-size:20px;font-weight:800;color:#2f73e6;">Box</span>
      <span style="font-size:12px;color:#7a869c;">&nbsp;&middot; Events Dashboard</span>
    </div>
    <div style="padding:16px 18px;background:#fff4e0;border:1px solid #f0d29a;border-radius:12px;margin:0 0 14px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#b26a00;font-weight:700;margin-bottom:8px;">${isDelete ? "Booking deleted" : "Status moved back"}</div>
      <div style="font-size:14px;color:#33415e;line-height:1.6;">${headline}</div>
    </div>
    <div style="padding:14px 18px;background:#ffffff;border:1px solid #dde3ee;border-radius:12px;">
      <table style="border-collapse:collapse;width:100%;">${tableRows}</table>
    </div>
    <div style="font-size:12px;color:#7a869c;line-height:1.6;padding:14px 4px 0;">
      ${esc(footer)} <a href="${appUrl}" style="color:#2f73e6;">Open the dashboard</a>
    </div>
  </div></body></html>`;
  const text = [
    subject,
    "",
    headline.replace(/<[^>]+>/g, ""),
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    footer,
    appUrl,
  ].join("\n");
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
  if (!resp.ok) console.error("Booking alert email failed", resp.status, body.slice(0, 200));
  return { sent: resp.ok, status: resp.status, to, body: body.slice(0, 200) };
}

export const sendBookingAlert = internalAction({
  args: {
    kind: v.union(v.literal("status_revert"), v.literal("deleted")),
    booking: v.object({
      name: v.string(),
      eventTitle: v.string(),
      date: v.string(),
      branch: v.string(),
      products: v.string(),
      location: v.string(),
      status: v.string(),
      quoteNumber: v.string(),
      invoiceNumber: v.string(),
      linked: v.boolean(),
    }),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    actorName: v.string(),
    at: v.number(),
    linkedRowsChanged: v.optional(v.number()),
  },
  handler: async (_ctx, alert) => {
    const { subject, html, text } = buildEmail(alert);
    return await sendEmail(ALERT_RECIPIENTS, subject, html, text);
  },
});

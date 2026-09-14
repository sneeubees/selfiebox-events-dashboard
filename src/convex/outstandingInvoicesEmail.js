// Monthly mailer (fires 1st of the month) listing completed events whose
// invoice number is still blank, scoped to the 3 full calendar months before
// the current one (by event date). Mirrors aiAnalysis.js's cron pattern: a
// gated internalMutation cron entry point + an admin-only public mutation for
// manual testing, both scheduling the same internalAction.

import { mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function requireAdminFromCtx(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) {
      user = (await ctx.db.query("users").collect()).find((u) => u.email === email) || null;
    }
  }
  if (!user || !user.isApproved || !user.isActive) throw new Error("Not authorised");
  if (user.role !== "admin") throw new Error("Admins only");
  return user;
}

function normalizeBranchValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}
const CT_BRANCHES = new Set(["CT", "CAPE TOWN", "CAPETOWN"]);
const KZN_BRANCHES = new Set(["KZN", "DURBAN", "KWAZULU-NATAL"]);
const NW_BRANCHES = new Set(["NW", "NORTH WEST"]);

function parseAmount(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const sanitized = text.replace(/[R\s]/gi, "");
  if (!sanitized) return 0;
  const hasComma = sanitized.includes(",");
  const hasDot = sanitized.includes(".");
  if (hasComma && hasDot) {
    const parsed = Number(sanitized.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (hasComma) {
    const parsed = Number(sanitized.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}
// Manual entry wins, falls back to the PDF-auto-extracted value - same
// precedence as the "Value (completed)" column on the General report's
// website quote success-rate table.
function eventAmount(event) {
  return parseAmount(event.exVat) || parseAmount(event.exVatAuto) || 0;
}
function formatRand(n) {
  return "R" + Math.round(n).toLocaleString("en-ZA");
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function saNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month") };
}

// Window = the 3 full calendar months before the current one, by event date.
// Run on 1 Oct -> startDate 1 Jul (incl.), endDate 1 Oct (excl.) -> Jul/Aug/Sep.
function outstandingInvoiceWindow() {
  const { year, month } = saNowParts();
  const pad = (n) => String(n).padStart(2, "0");
  let startY = year;
  let startM = month - 3;
  while (startM < 1) {
    startM += 12;
    startY -= 1;
  }
  const startDate = `${startY}-${pad(startM)}-01`;
  const endDate = `${year}-${pad(month)}-01`;
  const years = startY === year ? [startY] : [startY, year];
  return { startDate, endDate, years };
}

function monthLabel(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
}

function windowMonthLabel() {
  const { startDate, endDate } = outstandingInvoiceWindow();
  const [ey, em] = endDate.split("-").map(Number);
  let lastM = em - 1;
  let lastY = ey;
  if (lastM < 1) {
    lastM = 12;
    lastY -= 1;
  }
  const lastDate = `${lastY}-${String(lastM).padStart(2, "0")}-01`;
  return `${monthLabel(startDate)} - ${monthLabel(lastDate)}`;
}

export const gatherOutstandingInvoices = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { startDate, endDate, years } = outstandingInvoiceWindow();
    const rows = [];
    for (const year of years) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", year))
        .collect();
      for (const event of events) {
        const date = String(event.date || "");
        if (!date || date < startDate || date >= endDate) continue;
        if (normalizeStatus(event.status) !== "event completed") continue;
        if (String(event.invoiceNumber || "").trim()) continue;
        rows.push({
          name: event.name || event.eventTitle || "(unnamed)",
          date,
          branch: Array.isArray(event.branch) ? event.branch : [],
          quoteNumber: event.quoteNumber || "",
          amount: eventAmount(event),
        });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  },
});

function bucketRows(rows) {
  const buckets = { all: rows, ct: [], kzn: [], nw: [] };
  for (const r of rows) {
    const values = r.branch.map(normalizeBranchValue);
    if (values.some((v) => CT_BRANCHES.has(v))) buckets.ct.push(r);
    if (values.some((v) => KZN_BRANCHES.has(v))) buckets.kzn.push(r);
    if (values.some((v) => NW_BRANCHES.has(v))) buckets.nw.push(r);
  }
  return buckets;
}

const RECIPIENT_BUCKETS = [
  { key: "all", emails: ["info@selfiebox.co.za", "selfie@selfiebox.co.za"], label: "" },
  { key: "ct", emails: ["capetown@selfiebox.co.za"], label: "Cape Town" },
  { key: "kzn", emails: ["kzn@selfiebox.co.za"], label: "KZN / Durban" },
  { key: "nw", emails: ["northwest@selfiebox.co.za"], label: "North West" },
];

function buildRowsTable(rows) {
  if (!rows.length) {
    return `<div style="font-size:13.5px;color:#5a6880;">No outstanding invoices.</div>`;
  }
  const trs = rows.map((r) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#14264d;">${esc(r.name)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#33415e;white-space:nowrap;">${esc(r.date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#33415e;">${esc(r.branch.join(", "))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#33415e;">${esc(r.quoteNumber || "-")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#14264d;text-align:right;font-weight:600;">${esc(formatRand(r.amount))}</td>
    </tr>`).join("");
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>
        <th align="left" style="padding:0 10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Event</th>
        <th align="left" style="padding:0 10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Date</th>
        <th align="left" style="padding:0 10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Branch</th>
        <th align="left" style="padding:0 10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Quote #</th>
        <th align="right" style="padding:0 10px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Value</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <div style="font-size:12.5px;color:#7a869c;padding:8px 10px 0;">${rows.length} event${rows.length === 1 ? "" : "s"} &middot; ${esc(formatRand(total))} total</div>`;
}

function buildOutstandingInvoicesEmail({ label, rows, windowLabel }) {
  const subject = `Outstanding invoices${label ? ` - ${label}` : ""} (${rows.length})`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f9;">
  <div style="max-width:660px;margin:0 auto;padding:26px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="padding:6px 4px 18px;">
      <span style="font-size:20px;font-weight:800;color:#14264d;">Selfie</span><span style="font-size:20px;font-weight:800;color:#2f73e6;">Box</span>
      <span style="font-size:12px;color:#7a869c;">&nbsp;&middot; Outstanding invoices${label ? ` &middot; ${esc(label)}` : ""}</span>
    </div>
    <div style="font-size:14px;color:#33415e;line-height:1.6;margin:0 0 16px;">
      Completed events from ${esc(windowLabel)} that still don't have an invoice number in the dashboard.
    </div>
    <div style="padding:16px 14px;background:#ffffff;border:1px solid #e3e9f4;border-radius:12px;">
      ${buildRowsTable(rows)}
    </div>
    <div style="font-size:12px;color:#7a869c;line-height:1.6;padding:14px 4px 0;">
      Full list: <a href="https://events.selfiebox.co.za" style="color:#2f73e6;">events.selfiebox.co.za</a>. Automated monthly reminder, sent on the 1st.
    </div>
  </div></body></html>`;
  const text = [
    `Outstanding invoices${label ? ` - ${label}` : ""} (${rows.length})`,
    `Completed events from ${windowLabel} that still don't have an invoice number.`,
    "",
    ...rows.map((r) => `- ${r.name} | ${r.date} | ${r.branch.join(", ")} | Quote ${r.quoteNumber || "-"} | ${formatRand(r.amount)}`),
    "",
    "Full list: https://events.selfiebox.co.za",
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
  return { sent: resp.ok, status: resp.status, to, body: body.slice(0, 200) };
}

export const sendOutstandingInvoicesEmails = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.outstandingInvoicesEmail.gatherOutstandingInvoices, {});
    const windowLabel = windowMonthLabel();
    const buckets = bucketRows(rows);
    const results = [];
    for (const bucket of RECIPIENT_BUCKETS) {
      const bucketRows_ = buckets[bucket.key] || [];
      if (!bucketRows_.length) {
        results.push({ key: bucket.key, sent: false, reason: "no outstanding invoices" });
        continue;
      }
      const { subject, html, text } = buildOutstandingInvoicesEmail({ label: bucket.label, rows: bucketRows_, windowLabel });
      const result = await sendEmail(bucket.emails, subject, html, text);
      results.push({ key: bucket.key, count: bucketRows_.length, ...result });
    }
    console.log("[outstandingInvoicesEmail]", JSON.stringify({ windowLabel, total: rows.length, results }));
    return { windowLabel, total: rows.length, results };
  },
});

export const runOutstandingInvoicesMailerNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminFromCtx(ctx);
    await ctx.scheduler.runAfter(0, internal.outstandingInvoicesEmail.sendOutstandingInvoicesEmails, {});
    return { ok: true };
  },
});

// 1st of the month, 05:00 UTC = 07:00 SAST (no DST). No-ops unless
// OUTSTANDING_INVOICES_CRON_ENABLED=1 is set on this backend - off by default
// on both staging and live until Johan confirms he wants the automatic send.
export const cronRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.OUTSTANDING_INVOICES_CRON_ENABLED !== "1") return { ok: false, reason: "cron_disabled" };
    await ctx.scheduler.runAfter(0, internal.outstandingInvoicesEmail.sendOutstandingInvoicesEmails, {});
    return { ok: true };
  },
});

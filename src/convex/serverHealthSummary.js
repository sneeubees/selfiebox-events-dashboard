// 7-day Server Health summary: same content two ways - an on-demand admin
// query for the dashboard's "7 Day Summary" button, and a Monday 9am SAST
// email to info@/designs@. Both read from the same computeWeeklySummary()
// over the existing serverHealth table (7-day retention already matches).

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const SUMMARY_RECIPIENTS = ["info@selfiebox.co.za", "designs@selfiebox.co.za"];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function requireApprovedAdmin(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) user = (await ctx.db.query("users").collect()).find((c) => c.email === email) || null;
  }
  if (!user || !user.isApproved || !user.isActive || user.role !== "admin") return null;
  return user;
}

function saDateKey(ts) {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

async function computeWeeklySummary(ctx) {
  const now = Date.now();
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const rows = await ctx.db.query("serverHealth").withIndex("by_ts", (q) => q.gte("ts", since)).collect();
  if (!rows.length) return null;

  const hourly = new Map();
  const daily = new Map();
  const downAppsSet = new Set();
  let downHours = 0;

  for (const r of rows) {
    let host = {};
    let apps = [];
    try {
      const p = JSON.parse(r.payload);
      host = p.host || {};
      apps = p.apps || [];
    } catch { /* ignore malformed row */ }

    const hourKey = Math.floor(r.ts / 3600000);
    if (!hourly.has(hourKey)) hourly.set(hourKey, { n: 0, cpuSum: 0, cpuMax: 0, memSum: 0, memMax: 0, down: false });
    const h = hourly.get(hourKey);
    const cpu = Number(host.cpuPct) || 0;
    h.n += 1; h.cpuSum += cpu; h.cpuMax = Math.max(h.cpuMax, cpu);
    h.memSum += r.memPct; h.memMax = Math.max(h.memMax, r.memPct);

    const dKey = saDateKey(r.ts);
    daily.set(dKey, Math.max(daily.get(dKey) || 0, r.diskPct));

    const down = apps.filter((a) => !a.ok);
    if (down.length) {
      if (!h.down) downHours += 1;
      h.down = true;
      for (const a of down) downAppsSet.add(a.name);
    }
  }

  const hourlyArr = [...hourly.values()];
  const cpuAvg = Math.round(hourlyArr.reduce((s, h) => s + h.cpuSum / h.n, 0) / hourlyArr.length);
  const cpuMax = Math.max(...hourlyArr.map((h) => h.cpuMax));
  const sustainedHours = hourlyArr.filter((h) => h.cpuSum / h.n > 70).length;

  const memAvg = Math.round(hourlyArr.reduce((s, h) => s + h.memSum / h.n, 0) / hourlyArr.length);
  const memMax = Math.max(...hourlyArr.map((h) => h.memMax));

  const dailyPeaks = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, peakPct]) => ({ date, peakPct }));

  let diskTrend = "flat";
  let pctPerDay = 0;
  let gbPerDay = 0;
  let daysUntilFull = null;

  const latestRow = rows[rows.length - 1];
  let latestHost = {};
  try { latestHost = JSON.parse(latestRow.payload).host || {}; } catch { /* ignore */ }
  const diskTotalGb = Number(latestHost.diskTotalGb) || 0;
  const diskFreeGb = Number(latestHost.diskFreeGb) || 0;

  if (dailyPeaks.length >= 2) {
    const spanDays = dailyPeaks.length - 1;
    const delta = dailyPeaks[dailyPeaks.length - 1].peakPct - dailyPeaks[0].peakPct;
    pctPerDay = spanDays > 0 ? delta / spanDays : 0;
    if (pctPerDay > 0.15) diskTrend = "growing";
    else if (pctPerDay < -0.15) diskTrend = "shrinking";
    if (diskTrend === "growing" && diskTotalGb > 0) {
      gbPerDay = (pctPerDay / 100) * diskTotalGb;
      if (gbPerDay > 0) daysUntilFull = diskFreeGb / gbPerDay;
    }
  }

  const cpuVerdict = sustainedHours === 0 ? "fine" : "warn";
  const memVerdict = memAvg < 80 && memMax < 90 ? "fine" : "warn";
  const appsVerdict = downAppsSet.size === 0 ? "fine" : "warn";
  const diskVerdict = (diskTrend === "growing" && daysUntilFull != null && daysUntilFull < 14) || latestRow.diskPct >= 93 ? "warn" : "fine";

  return {
    rangeStart: since, rangeEnd: now, sampleCount: rows.length,
    cpu: { avg: cpuAvg, max: cpuMax, sustainedHours, verdict: cpuVerdict },
    mem: { avg: memAvg, max: memMax, liveUsedMb: latestHost.memUsedMb || 0, liveTotalMb: latestHost.memTotalMb || 0, verdict: memVerdict },
    apps: { downHours, downApps: [...downAppsSet], verdict: appsVerdict },
    disk: {
      dailyPeaks, pctPerDay, gbPerDay, daysUntilFull, trend: diskTrend,
      currentPct: latestRow.diskPct, diskTotalGb, diskFreeGb, verdict: diskVerdict,
    },
  };
}

export const getWeeklySummaryInternal = internalQuery({
  args: {},
  handler: async (ctx) => computeWeeklySummary(ctx),
});

export const getWeeklySummary = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireApprovedAdmin(ctx);
    if (!user) return null;
    return await computeWeeklySummary(ctx);
  },
});

function fmtDuration(days) {
  if (days == null) return null;
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

function buildWeeklySummaryEmail(s) {
  const when = new Date(s.rangeEnd).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "long", year: "numeric" });
  const subject = `SelfieBox server health — 7 day summary (${when})`;

  const rows = s.disk.dailyPeaks.map((d, i) => {
    const flag = d.peakPct >= 93 ? ' &larr; "issue" threshold' : "";
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#14264d;">${esc(d.date)}</td><td style="padding:6px 10px;border-bottom:1px solid #e3e9f4;font-size:13px;color:#33415e;">${d.peakPct}%${flag}</td></tr>`;
  }).join("");

  const diskLine = s.disk.trend === "growing"
    ? `That's a steady climb of about <strong>+${s.disk.pctPerDay.toFixed(1)} percentage points/day (~${s.disk.gbPerDay.toFixed(1)}GB/day)</strong>.${s.disk.daysUntilFull != null ? ` At that rate, with ${s.disk.diskFreeGb}GB free right now, the disk fills in roughly <strong>${fmtDuration(s.disk.daysUntilFull)}</strong> if nothing changes.` : ""}`
    : s.disk.trend === "shrinking"
      ? `Disk usage is trending down (about ${s.disk.pctPerDay.toFixed(1)} pts/day) - space was freed up this week.`
      : `Disk usage has been flat this week.`;

  const section = (title, verdict, lines) => `
    <div style="padding:14px 18px;background:#ffffff;border:1px solid #e3e9f4;border-radius:12px;margin:0 0 12px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${verdict === "fine" ? "#1d9e57" : "#c53c3c"};font-weight:700;margin-bottom:6px;">${esc(title)} &middot; ${verdict === "fine" ? "coping fine" : "worth a look"}</div>
      <div style="font-size:14px;color:#33415e;line-height:1.6;">${lines}</div>
    </div>`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f9;">
  <div style="max-width:640px;margin:0 auto;padding:26px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="padding:6px 4px 18px;">
      <span style="font-size:20px;font-weight:800;color:#14264d;">Selfie</span><span style="font-size:20px;font-weight:800;color:#2f73e6;">Box</span>
      <span style="font-size:12px;color:#7a869c;">&nbsp;&middot; Server Health &middot; 7 day summary</span>
    </div>
    ${section("CPU", s.cpu.verdict, `Averages ${s.cpu.avg}% all week, peak ${s.cpu.max}%.${s.cpu.sustainedHours ? ` ${s.cpu.sustainedHours} hour(s) had a sustained (hourly-average) load over 70%.` : " No sustained load - any spikes were brief."}`)}
    ${section("Memory", s.mem.verdict, `Steady ${s.mem.avg}% average, peaked at ${s.mem.max}% (currently ${s.mem.liveUsedMb}/${s.mem.liveTotalMb}MB).`)}
    ${section("App stability", s.apps.verdict, s.apps.downApps.length ? `${s.apps.downHours} hour(s) had an app down: ${esc(s.apps.downApps.join(", "))}.` : "Zero downtime - no monitored app went down and no container restarted all week.")}
    ${section("Disk", s.disk.verdict, `Currently ${s.disk.currentPct}% full (${s.disk.diskFreeGb}GB free of ${s.disk.diskTotalGb}GB). ${diskLine}`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e3e9f4;border-radius:12px;overflow:hidden;">
      <thead><tr><th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Date</th><th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7a869c;">Peak disk usage</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:12px;color:#7a869c;line-height:1.6;padding:14px 4px 0;">
      Full status: <a href="https://events.selfiebox.co.za" style="color:#2f73e6;">events.selfiebox.co.za</a> &rarr; Info &amp; Reporting &rarr; Server Health &rarr; 7 Day Summary.
    </div>
  </div></body></html>`;

  const text = [
    subject, "",
    `CPU (${s.cpu.verdict === "fine" ? "coping fine" : "worth a look"}): avg ${s.cpu.avg}%, peak ${s.cpu.max}%, ${s.cpu.sustainedHours} sustained-load hour(s).`,
    `Memory (${s.mem.verdict === "fine" ? "coping fine" : "worth a look"}): avg ${s.mem.avg}%, peak ${s.mem.max}%, currently ${s.mem.liveUsedMb}/${s.mem.liveTotalMb}MB.`,
    `App stability: ${s.apps.downApps.length ? `${s.apps.downHours}h down (${s.apps.downApps.join(", ")})` : "zero downtime"}.`,
    `Disk: currently ${s.disk.currentPct}% full, ${s.disk.diskFreeGb}GB free of ${s.disk.diskTotalGb}GB.`,
    "",
    ...s.disk.dailyPeaks.map((d) => `${d.date}: ${d.peakPct}%${d.peakPct >= 93 ? " (issue threshold)" : ""}`),
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

export const sendWeeklySummaryEmail = internalAction({
  args: {},
  handler: async (ctx) => {
    const summary = await ctx.runQuery(internal.serverHealthSummary.getWeeklySummaryInternal, {});
    if (!summary) return { sent: false, reason: "no health data yet" };
    const { subject, html, text } = buildWeeklySummaryEmail(summary);
    return await sendEmail(SUMMARY_RECIPIENTS, subject, html, text);
  },
});

export const sendWeeklySummaryNow = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireApprovedAdmin(ctx);
    if (!user) throw new Error("Admins only");
    await ctx.scheduler.runAfter(0, internal.serverHealthSummary.sendWeeklySummaryEmail, {});
    return { ok: true };
  },
});

// Monday 07:00 UTC = 09:00 SAST (no DST).
export const cronRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.SERVER_HEALTH_SUMMARY_CRON_ENABLED !== "1") return { ok: false, reason: "cron_disabled" };
    await ctx.scheduler.runAfter(0, internal.serverHealthSummary.sendWeeklySummaryEmail, {});
    return { ok: true };
  },
});

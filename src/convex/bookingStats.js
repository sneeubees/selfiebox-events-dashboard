import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Booking build-up stats: for a month, when did its bookings become CONFIRMED
// (= first moved to "In Progress")? Mirrors the Turnover Figures rules exactly:
// status Event Completed/In Progress, amount = customFields.custom_excl_jc
// (zeros are legit - multi-day/multi-region duplicates carry R0), region
// gp/ct/combined via the same branch mapping.
//
// Confirmation date per event, best evidence first:
//   1. statusTimeline (structured, stamped from Jul 2026 onward): first "In Progress".
//   2. Exact log entries "Updated Status to In Progress." (Jul 2026+ wording).
//   3. Old-style entries "Updated Status." (no target): if >=2 changes, the
//      SECOND-TO-LAST one (assumption: last change was to Event Completed);
//      if exactly 1, that one.
//   4. No status entries at all -> event.createdAt (added after the fact).

const MONTH_KEYS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GP_BRANCHES = new Set(["GP", "GAUTENG"]);
const CT_BRANCHES = new Set(["CT", "CAPE TOWN", "CAPETOWN"]);

function normalizeBranchValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}
function isIncludedStatus(status) {
  const s = normalizeStatus(status);
  return s === "event completed" || s === "in progress";
}
function parseAmount(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const sanitized = text.replace(/[R\s]/gi, "").replace(/,/g, ".");
  const n = parseFloat(sanitized.replace(/\.(?=.*\.)/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function requireAdmin(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = clerkId
    ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique()
    : null;
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) user = (await ctx.db.query("users").collect()).find((u) => u.email === email) || null;
  }
  if (!user || !user.isApproved || !user.isActive || user.role !== "admin") throw new Error("Admins only");
  return user;
}

function regionMatches(event, region) {
  const branches = Array.isArray(event.branch) ? event.branch.map(normalizeBranchValue) : [];
  const isGp = branches.some((b) => GP_BRANCHES.has(b));
  const isCt = branches.some((b) => CT_BRANCHES.has(b));
  if (region === "gp") return isGp;
  if (region === "ct") return isCt;
  return isGp || isCt; // combined
}

async function resolveConfirmedAt(ctx, event) {
  // 1) structured timeline
  const timeline = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
  const structured = timeline.find((t) => normalizeStatus(t.status) === "in progress");
  if (structured) return { at: structured.at, quality: "exact" };
  const structuredDone = timeline.find((t) => normalizeStatus(t.status) === "event completed");

  // activity log entries for this event
  const logs = await ctx.db
    .query("activityLog")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .collect();
  const statusLogs = logs
    .filter((l) => (l.text || "").includes("Updated Status"))
    .sort((a, b) => a.createdAt - b.createdAt);

  // 2) exact wording
  const exactInProgress = statusLogs.find((l) => l.text.includes("Updated Status to In Progress"));
  if (exactInProgress) return { at: exactInProgress.createdAt, quality: "exact" };
  const exactCompleted = statusLogs.find((l) => l.text.includes("Updated Status to Event Completed"));

  // 3) old-style heuristic (entries without a target value)
  const oldStyle = statusLogs.filter((l) => !/Updated Status to /.test(l.text));
  if (oldStyle.length >= 2) return { at: oldStyle[oldStyle.length - 2].createdAt, quality: "heuristic" };
  if (oldStyle.length === 1) return { at: oldStyle[0].createdAt, quality: "heuristic" };

  // jumped straight to completed with exact wording, never logged In Progress
  if (exactCompleted) return { at: exactCompleted.createdAt, quality: "exact" };
  if (structuredDone) return { at: structuredDone.at, quality: "exact" };

  // 4) never changed -> added after the fact
  return { at: event.createdAt, quality: "created" };
}

export const monthDrilldown = query({
  args: {
    workspaceYear: v.number(),
    monthIndex: v.number(), // 0-11
    region: v.string(), // 'gp' | 'ct' | 'combined'
  },
  handler: async (ctx, { workspaceYear, monthIndex, region }) => {
    await requireAdmin(ctx);

    const all = await ctx.db
      .query("events")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", workspaceYear))
      .collect();
    const monthEvents = all.filter((event) => {
      if (!isIncludedStatus(event.status)) return false;
      if (!regionMatches(event, region)) return false;
      const d = new Date(`${String(event.date || "").trim()}T12:00:00`);
      return Number.isFinite(d.getTime()) && d.getFullYear() === workspaceYear && d.getMonth() === monthIndex;
    });

    const monthStart = new Date(workspaceYear, monthIndex, 1).getTime();
    const monthEnd = new Date(workspaceYear, monthIndex + 1, 1).getTime();

    // calendar weeks (Mon-Sun) covering the month
    const weeks = [];
    let cursor = new Date(workspaceYear, monthIndex, 1);
    const day = (cursor.getDay() + 6) % 7; // Mon=0
    cursor = new Date(cursor.getTime() - day * 86400000);
    while (cursor.getTime() < monthEnd) {
      const start = cursor.getTime();
      const end = start + 7 * 86400000;
      weeks.push({
        start, end,
        label: `${new Date(Math.max(start, monthStart)).getDate()}–${new Date(Math.min(end, monthEnd) - 86400000).getDate()} ${MONTH_KEYS[monthIndex]}`,
        count: 0, amount: 0,
      });
      cursor = new Date(end);
    }

    const baseline = { count: 0, amount: 0 };
    const after = { count: 0, amount: 0 };
    const quality = { exact: 0, heuristic: 0, created: 0 };
    const leads = []; // {days, amount} per event

    for (const event of monthEvents) {
      const { at, quality: q } = await resolveConfirmedAt(ctx, event);
      const amount = parseAmount(event.customFields?.custom_excl_jc || event.customFields?.exclJc || "");
      quality[q] += 1;
      const eventDate = new Date(`${event.date}T12:00:00`).getTime();
      leads.push({ days: Math.max(0, Math.round((eventDate - at) / 86400000)), amount });
      if (at < monthStart) { baseline.count += 1; baseline.amount += amount; continue; }
      if (at >= monthEnd) { after.count += 1; after.amount += amount; continue; }
      const week = weeks.find((w) => at >= w.start && at < w.end);
      if (week) { week.count += 1; week.amount += amount; }
    }

    leads.sort((a, b) => a.days - b.days);
    const medianLead = leads.length ? leads[Math.floor(leads.length / 2)].days : 0;
    const bucket = (min, max) => {
      const hit = leads.filter((l) => l.days >= min && l.days <= max);
      return [hit.length, hit.reduce((s2, l) => s2 + l.amount, 0)];
    };
    const total = { count: monthEvents.length, amount: monthEvents.reduce((s, e) => s + parseAmount(e.customFields?.custom_excl_jc || e.customFields?.exclJc || ""), 0) };

    return {
      month: MONTH_KEYS[monthIndex], year: workspaceYear, region,
      baseline, after, total,
      weeks: weeks.map(({ label, count, amount }) => ({ label, count, amount })),
      medianLeadDays: medianLead,
      quality,
      leadBuckets: [
        ["0–7 days", ...bucket(0, 7)],
        ["1–4 weeks", ...bucket(8, 28)],
        ["1–3 months", ...bucket(29, 91)],
        ["3+ months", ...bucket(92, Infinity)],
      ],
    };
  },
});

// ---- staging sync (CLI-only, internal) ----
// Bundles of live events + their status-change log entries, keyed by eventKey.
// Re-links activityLog rows to the (possibly new) staging event ids.
export const ingestSyncBundle = internalMutation({
  args: { events: v.array(v.any()) },
  handler: async (ctx, { events }) => {
    let upserted = 0;
    for (const item of events) {
      const { statusChanges, ...fields } = item;
      const existing = await ctx.db
        .query("events")
        .withIndex("by_event_key", (q) => q.eq("eventKey", fields.eventKey))
        .unique();
      let eventId;
      if (existing) {
        const oldLogs = await ctx.db.query("activityLog").withIndex("by_event", (q) => q.eq("eventId", existing._id)).collect();
        for (const log of oldLogs) await ctx.db.delete(log._id);
        await ctx.db.replace(existing._id, { ...fields });
        eventId = existing._id;
      } else {
        eventId = await ctx.db.insert("events", { ...fields });
      }
      for (const change of statusChanges || []) {
        await ctx.db.insert("activityLog", {
          workspaceYear: fields.workspaceYear,
          eventId,
          eventName: fields.name || "",
          text: change.text,
          shortText: change.text,
          actorName: "live-sync",
          createdAt: change.createdAt,
        });
      }
      upserted += 1;
    }
    return { upserted };
  },
});

export const purgeYearExcept = internalMutation({
  args: { workspaceYear: v.number(), keepKeys: v.array(v.string()) },
  handler: async (ctx, { workspaceYear, keepKeys }) => {
    const keep = new Set(keepKeys);
    const all = await ctx.db
      .query("events")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", workspaceYear))
      .collect();
    let removed = 0;
    for (const event of all) {
      if (keep.has(event.eventKey)) continue;
      const logs = await ctx.db.query("activityLog").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect();
      for (const log of logs) await ctx.db.delete(log._id);
      await ctx.db.delete(event._id);
      removed += 1;
    }
    return { removed };
  },
});

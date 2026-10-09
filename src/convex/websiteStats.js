import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

function zaDate(timestampMs) {
  return new Date(timestampMs ?? Date.now()).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

async function requireCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) {
      user = (await ctx.db.query("users").collect()).find((candidate) => candidate.email === email) || null;
    }
  }
  if (!user || !user.isApproved || !user.isActive) {
    throw new Error("User access is pending approval.");
  }
  return user;
}

// See schema.js's comment on events.websiteOrigin: this field is stamped
// once at creation by websiteQuotes.js:submitWebsiteQuote and survives every
// later board save (unlike event.activity[], which events.js:upsert
// wholesale-replaces - discovered 2026-09-09 auditing why almost no August
// website-origin events still carried their activity marker).
function isWebsiteQuoteOrigin(record) {
  return Boolean(record.websiteOrigin);
}

// increments today's counter for the given field ("visits" | "quotes")
export async function bumpStat(ctx, field) {
  const date = zaDate();
  const row = await ctx.db
    .query("websiteStats")
    .withIndex("by_date", (q) => q.eq("date", date))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, { [field]: (row[field] || 0) + 1 });
  } else {
    await ctx.db.insert("websiteStats", {
      date,
      visits: field === "visits" ? 1 : 0,
      quotes: field === "quotes" ? 1 : 0,
    });
  }
}

export const recordVisit = internalMutation({
  args: {},
  handler: async (ctx) => {
    await bumpStat(ctx, "visits");
    return { ok: true };
  },
});

export const getWebsiteStats = query({
  args: {},
  handler: async (ctx) => {
    const today = zaDate();
    // Staff only. Return an empty result rather than throwing so a signed-out
    // or pending browser never white-screens on this query.
    try {
      await requireCurrentUser(ctx);
    } catch (error) {
      return { today, days: [] };
    }
    const rows = await ctx.db.query("websiteStats").collect();
    const days = rows
      .map((r) => ({ date: r.date, visits: r.visits || 0, quotes: r.quotes || 0 }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { today, days };
  },
});

// When an event's status LAST became "Event Completed" - not when the
// event happened, and not when the quote was submitted. Completion is
// routinely marked days after the event itself (e.g. a Friday event only
// gets marked complete the following Monday/Tuesday), so this is what
// "conversions in the last 7 days" actually needs to bucket by. Sourced
// from statusTimeline (appended by events.js:upsert on every real status
// change - see the comment there), falling back to updatedAt for the rare
// event with no timeline entry for it (e.g. status set some other way).
function resolveCompletedAt(event) {
  const timeline = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].status === "Event Completed") {
      return timeline[i].at;
    }
  }
  return event.updatedAt;
}

// Website quotes that actually converted into a completed event - i.e. the
// event line item the website itself created (not a day-2/day-3 duplicate
// of a multi-day booking) whose status is currently Event Completed.
// Bucketed by the day it was MARKED completed (see resolveCompletedAt), so
// "last 7 days" means "closed in the last 7 days" - not "submitted in the
// last 7 days" (that's what Quote Requests already measures) and not "the
// event happened in the last 7 days" (completion lags the event itself).
//
// A plain events.collect() timed out on live (13k+ rows) as a reactive
// query, so - mirroring clientRecencyCache in events.js - history is
// precomputed into quoteConversionCache and only the active calendar year
// is scanned live at query time.
function tallyConversions(counts, events) {
  for (const event of events) {
    if (event.status !== "Event Completed") continue;
    if (event.duplicatedFromEventKey) continue;
    if (!isWebsiteQuoteOrigin(event)) continue;
    const date = zaDate(resolveCompletedAt(event));
    counts.set(date, (counts.get(date) || 0) + 1);
  }
}

function getCurrentWorkspaceYear() {
  return new Date().getFullYear();
}

async function rebuildQuoteConversionCacheImpl(ctx) {
  const currentYear = getCurrentWorkspaceYear();
  const pastEvents = await ctx.db.query("events").withIndex("by_workspace_year", (q) => q.lt("workspaceYear", currentYear)).collect();
  const futureEvents = await ctx.db.query("events").withIndex("by_workspace_year", (q) => q.gt("workspaceYear", currentYear)).collect();

  const counts = new Map();
  tallyConversions(counts, pastEvents);
  tallyConversions(counts, futureEvents);

  const existingCacheRows = await ctx.db.query("quoteConversionCache").collect();
  for (const row of existingCacheRows) {
    await ctx.db.delete(row._id);
  }
  for (const [date, count] of counts) {
    await ctx.db.insert("quoteConversionCache", { date, count });
  }

  const existingMeta = await ctx.db.query("quoteConversionCacheMeta").collect();
  for (const row of existingMeta) {
    await ctx.db.delete(row._id);
  }
  await ctx.db.insert("quoteConversionCacheMeta", { excludedYear: currentYear, updatedAt: Date.now() });

  return { cachedDays: counts.size, excludedYear: currentYear, eventsCached: pastEvents.length + futureEvents.length };
}

// Called automatically whenever a new workspace year is created (see
// workspaces.js) so the cache heals itself at each year rollover.
export const rebuildQuoteConversionCacheInternal = internalMutation({
  args: {},
  handler: async (ctx) => rebuildQuoteConversionCacheImpl(ctx),
});

// Manual trigger (admin-only) - for the initial backfill right after
// deploying this feature, and for on-demand refresh.
export const rebuildQuoteConversionCache = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    if (user.role !== "admin") throw new Error("Only admins can rebuild this cache.");
    return await rebuildQuoteConversionCacheImpl(ctx);
  },
});

export const getQuoteConversions = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return { days: [] };
    }

    const currentYear = getCurrentWorkspaceYear();
    const metaRows = await ctx.db.query("quoteConversionCacheMeta").collect();
    const meta = metaRows[0];
    const counts = new Map();

    if (meta && meta.excludedYear === currentYear) {
      const cachedRows = await ctx.db.query("quoteConversionCache").collect();
      for (const row of cachedRows) counts.set(row.date, row.count);
      const currentYearEvents = await ctx.db
        .query("events")
        .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", currentYear))
        .collect();
      tallyConversions(counts, currentYearEvents);
    } else {
      // Rare fallback (no cache yet, or a year just rolled over and the
      // cache hasn't caught up): same full scan as before this fix - not
      // the common case anymore.
      const events = await ctx.db.query("events").collect();
      tallyConversions(counts, events);
    }

    const days = Array.from(counts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { days };
  },
});

// One-time backfill for events.websiteOrigin on events created BEFORE that
// field existed (see schema.js). Source of truth: the append-only
// activityLog table (indexed by_event) - unlike event.activity[], upsert
// never touches it, so it still has the "Website quote submitted" marker
// for events whose embedded activity array was later wiped by a board save.
// A full activityLog collect times out even scoped to one workspaceYear (a
// huge table), so this looks it up per-candidate-event via the indexed
// query instead, batched through an action since that can involve
// thousands of small lookups (mutations cap out around 15s; actions don't).
// Scoped to `workspaceYear` (pass the year(s) the website was actually live
// in - no true website-origin event can predate the site launch).
export const listBackfillCandidates = internalQuery({
  args: { workspaceYear: v.number() },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", args.workspaceYear))
      .collect();
    return events.filter((e) => !e.websiteOrigin).map((e) => e._id);
  },
});

export const backfillWebsiteOriginBatch = internalMutation({
  args: { eventIds: v.array(v.id("events")) },
  handler: async (ctx, args) => {
    let updated = 0;
    for (const eventId of args.eventIds) {
      const logs = await ctx.db
        .query("activityLog")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
      const hasMarker = logs.some((l) => String(l.text || "").startsWith("Website quote submitted"));
      if (hasMarker) {
        await ctx.db.patch(eventId, { websiteOrigin: true });
        updated += 1;
      }
    }
    return updated;
  },
});

export const backfillWebsiteOriginAction = internalAction({
  args: { workspaceYear: v.number() },
  handler: async (ctx, args) => {
    const eventIds = await ctx.runQuery(internal.websiteStats.listBackfillCandidates, { workspaceYear: args.workspaceYear });
    let totalUpdated = 0;
    const batchSize = 100;
    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);
      totalUpdated += await ctx.runMutation(internal.websiteStats.backfillWebsiteOriginBatch, { eventIds: batch });
    }
    return { scanned: eventIds.length, updated: totalUpdated };
  },
});

// Manual trigger (admin-only). Kicks off the action above in the
// background - check the Convex dashboard/logs for its result, or just
// re-run getQuoteConversions afterward to see the corrected numbers.
export const backfillWebsiteOrigin = mutation({
  args: { workspaceYear: v.number() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    if (user.role !== "admin") throw new Error("Only admins can run this backfill.");
    await ctx.scheduler.runAfter(0, internal.websiteStats.backfillWebsiteOriginAction, { workspaceYear: args.workspaceYear });
    return { scheduled: true };
  },
});

// ---- Year-end special landing pages: requests + conversions per offer ----
export const OFFER_PAGES = [
  { code: "YEAR_END_360_2026_LED_STANCHIONS", path: "/year-end-360/", label: "Year-End 360" },
  { code: "YEAR_END_2026_EXTRA_HOUR", path: "/year-end-photo-booths/", label: "Year-End Photo Booths" },
];

function sastBounds(startDate, endDate) {
  const parse = (d, end) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "").trim());
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 2 * 3600 * 1000; // 00:00 SAST
    return end ? ms + 24 * 3600 * 1000 - 1 : ms;
  };
  return { from: parse(startDate, false), to: parse(endDate, true) };
}

function offerCodeFromNotes(text) {
  return (String(text || "").match(/\[OFFER:\s*([A-Z0-9_]+)\]/) || [])[1] || "";
}

// Quote requests that came from a special landing page, created in the date
// range, and how many of them reached In Progress (= converted).
export const getOfferStats = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireCurrentUser(ctx);
    } catch (error) {
      return null;
    }
    const { from, to } = sastBounds(args.startDate, args.endDate);
    if (from === null || to === null) return { pages: [], range: args };
    // Event dates can fall in the next calendar year, so scan the request year and the next.
    const y0 = Number(args.startDate.slice(0, 4));
    const y1 = Number(args.endDate.slice(0, 4)) + 1;
    const counts = Object.fromEntries(OFFER_PAGES.map((p) => [p.code, { requests: 0, converted: 0, completed: 0 }]));
    for (let year = y0; year <= y1; year += 1) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", year))
        .collect();
      for (const event of events) {
        if (!event.websiteOrigin) continue;
        const created = Number.isFinite(event.createdAt) ? event.createdAt : event._creationTime;
        if (created < from || created > to) continue;
        let code = event.websiteOffer || "";
        if (!code) {
          // Requests from before the code was stored on the event: read the booking notes.
          const booking = await ctx.db
            .query("eventBookings")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .unique();
          code = offerCodeFromNotes(booking?.formData?.notes);
        }
        if (!code || !counts[code]) continue;
        counts[code].requests += 1;
        const timeline = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
        const status = String(event.status || "").trim().toLowerCase();
        const reachedInProgress = status === "in progress" || status === "event completed"
          || timeline.some((e) => String(e.status || "").trim().toLowerCase() === "in progress");
        if (reachedInProgress) counts[code].converted += 1;
        if (status === "event completed") counts[code].completed += 1;
      }
    }
    return {
      range: args,
      pages: OFFER_PAGES.map((p) => ({ ...p, ...counts[p.code], conversionPct: counts[p.code].requests ? Math.round((100 * counts[p.code].converted) / counts[p.code].requests) : null })),
    };
  },
});

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

// "Response Times" report (Johan, 2026-09-23): how long each step of an event
// takes. Everything comes from events.statusTimeline (stamped on every status
// change since 2026-08-25, and backfilled from the activity log for earlier
// events by backfillTimelineFromLog below) plus eventFiles for the invoice.
// Calendar time, not business hours. Reads are sequential on purpose (no
// Promise.all - it has crashed this self-hosted backend before).

const STATUS = {
  quoteSent: "quote sent",
  inProgress: "in progress",
  cancelled: "cancelled",
  completed: "event completed",
};

async function requireApprovedUser(ctx) {
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

// 'YYYY-MM-DD' -> ms at 00:00 South African time.
function sastMidnight(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
  if (!match) {
    return null;
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 2 * 60 * 60 * 1000;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function firstAt(timeline, statusName) {
  for (const entry of timeline) {
    if (normalizeStatus(entry.status) === statusName) {
      return entry.at;
    }
  }
  return null;
}

function isInvoiceFile(name) {
  const text = String(name || "").trim();
  return /^inv\d/i.test(text) || /invoice/i.test(text);
}

function summarize(items) {
  const durations = items.map((item) => item.ms).sort((left, right) => left - right);
  const count = durations.length;
  if (!count) {
    return { count: 0, medianMs: null, averageMs: null, minMs: null, maxMs: null };
  }
  const middle = Math.floor(count / 2);
  const medianMs = count % 2 ? durations[middle] : Math.round((durations[middle - 1] + durations[middle]) / 2);
  const averageMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / count);
  return { count, medianMs, averageMs, minMs: durations[0], maxMs: durations[count - 1] };
}

async function computeResponseTimes(ctx, workspaceYear) {
  const events = await ctx.db
    .query("events")
    .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", workspaceYear))
    .collect();
  const users = await ctx.db.query("users").collect();
  const nameById = new Map(users.map((user) => [String(user._id), user.fullName || [user.firstName, user.surname].filter(Boolean).join(" ") || user.email || ""]));

  const sections = {
    createdToQuote: [],
    quoteToInProgress: [],
    inProgressToInvoice: [],
    quoteToCancelled: [],
    eventToCompleted: [],
  };
  const excluded = { noTimeline: 0, createdAsQuoteSent: 0, invoiceBeforeInProgress: 0, completedBeforeEventDay: 0 };
  let withTimeline = 0;
  let earliestTimeline = null;

  for (const event of events) {
    const timeline = (Array.isArray(event.statusTimeline) ? event.statusTimeline : [])
      .filter((entry) => entry && Number.isFinite(entry.at))
      .sort((left, right) => left.at - right.at);
    if (timeline.length) {
      withTimeline += 1;
      if (earliestTimeline === null || timeline[0].at < earliestTimeline) {
        earliestTimeline = timeline[0].at;
      }
    } else {
      excluded.noTimeline += 1;
    }

    const base = {
      eventKey: event.eventKey,
      name: event.name || "Untitled event",
      date: event.date || "",
      branch: Array.isArray(event.branch) ? event.branch : [],
      source: event.websiteOrigin ? "website" : "manual",
    };
    const createdAt = Number.isFinite(event.createdAt) ? event.createdAt : event._creationTime;
    const quoteAt = firstAt(timeline, STATUS.quoteSent);
    const inProgressAt = firstAt(timeline, STATUS.inProgress);
    const cancelledAt = firstAt(timeline, STATUS.cancelled);
    const completedAt = firstAt(timeline, STATUS.completed);

    // A. created -> Quote Sent. Rows created already as "Quote Sent" have no
    // transition to measure and are counted separately.
    if (quoteAt !== null && quoteAt >= createdAt) {
      sections.createdToQuote.push({
        ...base,
        fromAt: createdAt,
        toAt: quoteAt,
        ms: quoteAt - createdAt,
        handledBy: base.source === "website" ? (nameById.get(String(event.firstStatusChangeByUserId || "")) || "") : "",
      });
    } else if (quoteAt === null && normalizeStatus(event.status) === STATUS.quoteSent) {
      excluded.createdAsQuoteSent += 1;
    }

    // B. Quote Sent -> In Progress (client confirmation time).
    if (quoteAt !== null && inProgressAt !== null && inProgressAt >= quoteAt) {
      sections.quoteToInProgress.push({ ...base, fromAt: quoteAt, toAt: inProgressAt, ms: inProgressAt - quoteAt });
    }

    // C. In Progress -> first invoice PDF uploaded.
    if (inProgressAt !== null) {
      const files = await ctx.db
        .query("eventFiles")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      let invoiceAt = null;
      let invoiceName = "";
      for (const file of files) {
        if (isInvoiceFile(file.name) && Number.isFinite(file.createdAt) && (invoiceAt === null || file.createdAt < invoiceAt)) {
          invoiceAt = file.createdAt;
          invoiceName = file.name;
        }
      }
      if (invoiceAt !== null) {
        if (invoiceAt >= inProgressAt) {
          sections.inProgressToInvoice.push({ ...base, fromAt: inProgressAt, toAt: invoiceAt, ms: invoiceAt - inProgressAt, fileName: invoiceName });
        } else {
          excluded.invoiceBeforeInProgress += 1;
        }
      }
    }

    // D. Quote Sent -> Cancelled.
    if (quoteAt !== null && cancelledAt !== null && cancelledAt >= quoteAt) {
      sections.quoteToCancelled.push({ ...base, fromAt: quoteAt, toAt: cancelledAt, ms: cancelledAt - quoteAt });
    }

    // E. Event day (00:00 SAST) -> Event Completed.
    const eventStart = sastMidnight(event.date);
    if (eventStart !== null && completedAt !== null) {
      if (completedAt >= eventStart) {
        sections.eventToCompleted.push({ ...base, fromAt: eventStart, toAt: completedAt, ms: completedAt - eventStart });
      } else {
        excluded.completedBeforeEventDay += 1;
      }
    }
  }

  const result = {};
  for (const [key, items] of Object.entries(sections)) {
    items.sort((left, right) => right.toAt - left.toAt);
    result[key] = { ...summarize(items), items };
  }
  return {
    workspaceYear,
    generatedAt: Date.now(),
    coverage: { events: events.length, withTimeline, earliestTimeline },
    excluded,
    sections: result,
  };
}

export const get = query({
  args: { workspaceYear: v.number() },
  handler: async (ctx, args) => {
    try {
      await requireApprovedUser(ctx);
    } catch (error) {
      return null;
    }
    return computeResponseTimes(ctx, args.workspaceYear);
  },
});

// Admin key / CLI only - same data, for checking the report without a login.
export const getInternal = internalQuery({
  args: { workspaceYear: v.number() },
  handler: async (ctx, args) => computeResponseTimes(ctx, args.workspaceYear),
});

// "Updated Status to In Progress." / "Updated Hours to 8, Status to Quote Sent."
// Fields are listed as "<Field> to <value>" separated by ", ", so only a part
// that STARTS with "Status to " counts (a client called "Status to Go" does not).
function statusFromLogText(text) {
  const source = String(text || "").trim();
  if (!source.startsWith("Updated ")) {
    return "";
  }
  const parts = source.slice("Updated ".length).replace(/\.$/, "").split(", ");
  for (const part of parts) {
    if (part.startsWith("Status to ")) {
      return part.slice("Status to ".length).trim();
    }
  }
  return "";
}

// One-off backfill (admin key / CLI): statusTimeline only exists for changes
// made since 2026-08-25, but the activity log has "Updated Status to X." for
// the whole year. Runs in pages so one call never reads too much; call again
// with the returned continueCursor until isDone.
//   convex run responseTimes:backfillTimelineFromLog '{"workspaceYear":2026,"cursor":null}'
export const backfillTimelineFromLog = internalMutation({
  args: {
    workspaceYear: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("events")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", args.workspaceYear))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(Math.max(args.numItems || 20, 1), 50) });

    let scanned = 0;
    let updated = 0;
    let added = 0;
    for (const event of page.page) {
      scanned += 1;
      const logs = await ctx.db
        .query("activityLog")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const derived = [];
      for (const entry of logs) {
        const status = statusFromLogText(entry.text);
        if (status && Number.isFinite(entry.createdAt)) {
          derived.push({ status, at: entry.createdAt });
        }
      }
      if (!derived.length) {
        continue;
      }
      const existing = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
      const merged = existing.slice();
      for (const candidate of derived) {
        const duplicate = merged.some((entry) => normalizeStatus(entry.status) === normalizeStatus(candidate.status) && Math.abs(entry.at - candidate.at) < 60 * 1000);
        if (!duplicate) {
          merged.push(candidate);
          added += 1;
        }
      }
      if (merged.length !== existing.length) {
        merged.sort((left, right) => left.at - right.at);
        await ctx.db.patch(event._id, { statusTimeline: merged });
        updated += 1;
      }
    }
    return { scanned, updated, added, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

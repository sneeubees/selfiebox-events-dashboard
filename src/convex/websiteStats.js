import { mutation, query } from "./_generated/server";

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

// Website-submitted quotes stamp this exact activity entry at creation time
// (see websiteQuotes.js:submitWebsiteQuote) - it's the only durable signal
// that an event line item originated from the website (no dedicated
// "source" field exists). Wording changed once historically ("... submitted
// on staging." -> "... submitted."), hence the prefix match.
function isWebsiteQuoteOrigin(record) {
  return (record.activity || []).some((entry) => String(entry?.text || "").startsWith("Website quote submitted"));
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

export const recordVisit = mutation({
  args: {},
  handler: async (ctx) => {
    await bumpStat(ctx, "visits");
    return { ok: true };
  },
});

export const getWebsiteStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("websiteStats").collect();
    const today = zaDate();
    const days = rows
      .map((r) => ({ date: r.date, visits: r.visits || 0, quotes: r.quotes || 0 }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { today, days };
  },
});

// Website quotes that actually converted into a completed event - i.e. the
// event line item the website itself created (not a day-2/day-3 duplicate
// of a multi-day booking) whose status is currently Event Completed.
// Bucketed by the quote's original submission day (createdAt), the same way
// getWebsiteStats buckets "Quote Requests", so the two can be compared
// directly for the same period. Backdated for free: existing historical
// events already carry everything needed (no migration required).
export const getQuoteConversions = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return { days: [] };
    }

    const events = await ctx.db.query("events").collect();
    const counts = new Map();
    for (const event of events) {
      if (event.status !== "Event Completed") continue;
      if (event.duplicatedFromEventKey) continue;
      if (!isWebsiteQuoteOrigin(event)) continue;
      const date = zaDate(event.createdAt);
      counts.set(date, (counts.get(date) || 0) + 1);
    }

    const days = Array.from(counts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { days };
  },
});

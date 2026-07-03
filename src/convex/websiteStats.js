import { mutation, query } from "./_generated/server";

function zaDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
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

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function requireCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const clerkId = identity.subject ?? identity.tokenIdentifier;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();

  if (!user) {
    throw new Error("User record not found.");
  }
  if (!user.isApproved || !user.isActive) {
    throw new Error("User access is pending approval.");
  }
  if (user.role !== "admin") {
    throw new Error("Only admins can manage commission exports.");
  }

  return user;
}

export const saveSnapshot = mutation({
  args: {
    month: v.string(),
    year: v.number(),
    period: v.string(),
    attendant: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("commissionSnapshots", {
      month: args.month,
      year: args.year,
      period: args.period,
      attendant: args.attendant,
      storageId: args.storageId,
      fileName: args.fileName,
      createdAt: now,
      createdByUserId: currentUser._id,
    });
    return { id };
  },
});

export const listSnapshots = query({
  args: {
    month: v.string(),
    year: v.number(),
    attendant: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const rows = await ctx.db
      .query("commissionSnapshots")
      .withIndex("by_month_attendant", (q) => q.eq("year", args.year).eq("month", args.month).eq("attendant", args.attendant))
      .collect();

    const enriched = await Promise.all(rows.map(async (row) => ({
      id: row._id,
      fileName: row.fileName,
      period: row.period,
      createdAt: row.createdAt,
      url: (await ctx.storage.getUrl(row.storageId)) || "",
    })));

    return enriched.sort((left, right) => right.createdAt - left.createdAt);
  },
});

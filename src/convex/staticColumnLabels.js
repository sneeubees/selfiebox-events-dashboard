import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

  return user;
}

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    return await ctx.db.query("staticColumnLabels").collect();
  },
});

export const upsert = mutation({
  args: {
    columnKey: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can rename column headers.");
    }

    const label = String(args.label || "").trim();
    if (!label) {
      throw new Error("Column header name is required.");
    }

    const existing = await ctx.db
      .query("staticColumnLabels")
      .withIndex("by_column_key", (q) => q.eq("columnKey", args.columnKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        label,
        updatedAt: Date.now(),
      });
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("staticColumnLabels", {
      columnKey: args.columnKey,
      label,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

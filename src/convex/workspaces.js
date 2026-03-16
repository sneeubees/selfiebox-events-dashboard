import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function getCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const clerkId = identity.subject ?? identity.tokenIdentifier;
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

async function requireApprovedUser(ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Not authenticated.");
  }
  if (!user.isApproved || !user.isActive) {
    throw new Error("User access is pending approval.");
  }
  return user;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireApprovedUser(ctx);
    } catch {
      return [];
    }
    const workspaces = await ctx.db.query("workspaces").collect();
    return workspaces.sort((left, right) => left.year - right.year).map((workspace) => ({
      id: workspace._id,
      year: workspace.year,
      name: workspace.name,
    }));
  },
});

export const createNextYear = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireApprovedUser(ctx);
    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Only admins can add workspaces.");
    }

    const existing = await ctx.db.query("workspaces").collect();
    const highestYear = existing.length ? Math.max(...existing.map((workspace) => workspace.year)) : new Date().getFullYear();
    const nextYear = highestYear + 1;

    const duplicate = await ctx.db
      .query("workspaces")
      .withIndex("by_year", (q) => q.eq("year", nextYear))
      .unique();

    if (duplicate) {
      return { id: duplicate._id, year: duplicate.year, name: duplicate.name };
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      year: nextYear,
      name: String(nextYear),
      createdByUserId: currentUser._id,
      createdAt: Date.now(),
    });

    const created = await ctx.db.get(workspaceId);
    return { id: created._id, year: created.year, name: created.name };
  },
});

export const ensureYear = mutation({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const currentUser = await requireApprovedUser(ctx);

    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_year", (q) => q.eq("year", args.year))
      .unique();

    if (existing) {
      return { id: existing._id, year: existing.year, name: existing.name, created: false };
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      year: args.year,
      name: String(args.year),
      createdByUserId: currentUser._id,
      createdAt: Date.now(),
    });

    const created = await ctx.db.get(workspaceId);
    return { id: created._id, year: created.year, name: created.name, created: true };
  },
});

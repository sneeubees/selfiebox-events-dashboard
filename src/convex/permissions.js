import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

  if (!user) {
    throw new Error("User record not found.");
  }
  if (!user.isApproved || !user.isActive) {
    throw new Error("User access is pending approval.");
  }

  return user;
}

function toPermissionRecord(record) {
  return {
    id: String(record._id),
    columnKey: record.columnKey,
    subjectType: record.subjectType,
    role: record.role || "",
    userId: record.userId ? String(record.userId) : "",
    canView: record.canView,
    canEdit: record.canEdit,
  };
}

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    let currentUser;
    try {
      currentUser = await requireCurrentUser(ctx);
    } catch {
      return [];
    }
    if (currentUser.role !== "admin") {
      return [];
    }

    const permissions = await ctx.db.query("columnPermissions").collect();
    return permissions.map(toPermissionRecord);
  },
});

export const currentUserRights = query({
  args: {},
  handler: async (ctx) => {
    let currentUser;
    try {
      currentUser = await requireCurrentUser(ctx);
    } catch {
      return {};
    }
    const permissions = await ctx.db.query("columnPermissions").collect();

    const rights = {};
    for (const entry of permissions) {
      if (!rights[entry.columnKey]) {
        rights[entry.columnKey] = { canView: true, canEdit: true };
      }
    }

    if (currentUser.role === "admin") {
      return rights;
    }

    for (const entry of permissions) {
      if (entry.subjectType === "role" && entry.role === currentUser.role) {
        rights[entry.columnKey] = { canView: entry.canView, canEdit: entry.canEdit && entry.canView };
      }
    }

    for (const entry of permissions) {
      if (entry.subjectType === "user" && entry.userId && String(entry.userId) === String(currentUser._id)) {
        rights[entry.columnKey] = { canView: entry.canView, canEdit: entry.canEdit && entry.canView };
      }
    }

    return rights;
  },
});

export const upsert = mutation({
  args: {
    columnKey: v.string(),
    subjectType: v.union(v.literal("role"), v.literal("user")),
    role: v.optional(v.union(v.literal("admin"), v.literal("manager"), v.literal("user"))),
    userId: v.optional(v.id("users")),
    canView: v.boolean(),
    canEdit: v.boolean(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can manage column rights.");
    }

    const existing = args.subjectType === "role"
      ? await ctx.db
        .query("columnPermissions")
        .withIndex("by_column_role", (q) => q.eq("columnKey", args.columnKey).eq("role", args.role))
        .unique()
      : await ctx.db
        .query("columnPermissions")
        .withIndex("by_column_user", (q) => q.eq("columnKey", args.columnKey).eq("userId", args.userId))
        .unique();

    const payload = {
      columnKey: args.columnKey,
      subjectType: args.subjectType,
      role: args.subjectType === "role" ? args.role : undefined,
      userId: args.subjectType === "user" ? args.userId : undefined,
      canView: args.canView,
      canEdit: args.canView ? args.canEdit : false,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return toPermissionRecord(await ctx.db.get(existing._id));
    }

    const permissionId = await ctx.db.insert("columnPermissions", payload);
    return toPermissionRecord(await ctx.db.get(permissionId));
  },
});

export const remove = mutation({
  args: {
    permissionId: v.id("columnPermissions"),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can manage column rights.");
    }

    await ctx.db.delete(args.permissionId);
    return String(args.permissionId);
  },
});

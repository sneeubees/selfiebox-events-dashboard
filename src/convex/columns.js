import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

function slugifyLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "column";
}

function toColumnDto(record) {
  return {
    id: String(record._id),
    columnKey: record.columnKey,
    label: record.label,
    type: record.type,
    order: record.order,
  };
}

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const columns = await ctx.db.query("customColumns").withIndex("by_order").collect();
    return columns
      .filter((column) => column.isActive)
      .sort((left, right) => left.order - right.order)
      .map(toColumnDto);
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("number"),
      v.literal("date"),
      v.literal("singleItem"),
      v.literal("multiItem"),
    ),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (!["admin", "manager"].includes(currentUser.role)) {
      throw new Error("Only admins and managers can add columns.");
    }

    const label = String(args.label || "").trim();
    if (!label) {
      throw new Error("Column name is required.");
    }

    const allColumns = await ctx.db.query("customColumns").collect();
    const normalizedLabel = label.toLowerCase();
    const duplicate = allColumns.find((column) => column.isActive && column.label.trim().toLowerCase() === normalizedLabel);
    if (duplicate) {
      throw new Error("A column with that name already exists.");
    }

    const takenKeys = new Set(allColumns.map((column) => column.columnKey));
    const baseKey = "custom_" + slugifyLabel(label);
    let columnKey = baseKey;
    let suffix = 2;
    while (takenKeys.has(columnKey)) {
      columnKey = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    const nextOrder = allColumns.length
      ? Math.max(...allColumns.map((column) => column.order || 0)) + 1
      : 0;

    const id = await ctx.db.insert("customColumns", {
      columnKey,
      label,
      type: args.type,
      order: nextOrder,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return toColumnDto(await ctx.db.get(id));
  },
});

export const convertToSingleItem = mutation({
  args: {
    columnKey: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can convert columns.");
    }

    const existing = await ctx.db
      .query("customColumns")
      .withIndex("by_column_key", (q) => q.eq("columnKey", args.columnKey))
      .unique();

    if (!existing) {
      throw new Error("Column not found.");
    }

    if (existing.type === "singleItem") {
      return toColumnDto(existing);
    }

    await ctx.db.patch(existing._id, {
      type: "singleItem",
      updatedAt: Date.now(),
    });

    const events = await ctx.db.query("events").collect();
    for (const event of events) {
      const currentValue = (event.customFields || {})[args.columnKey];
      if (!Array.isArray(currentValue)) {
        continue;
      }
      const nextValue = currentValue[0] || "";
      await ctx.db.patch(event._id, {
        customFields: {
          ...(event.customFields || {}),
          [args.columnKey]: nextValue,
        },
        updatedAt: Date.now(),
      });
    }

    return toColumnDto(await ctx.db.get(existing._id));
  },
});

export const remove = mutation({
  args: {
    columnKey: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can delete columns.");
    }

    const existing = await ctx.db
      .query("customColumns")
      .withIndex("by_column_key", (q) => q.eq("columnKey", args.columnKey))
      .unique();

    if (!existing) {
      throw new Error("Column not found.");
    }

    await ctx.db.patch(existing._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return args.columnKey;
  },
});

export const rename = mutation({
  args: {
    columnKey: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can rename columns.");
    }

    const label = String(args.label || "").trim();
    if (!label) {
      throw new Error("Column name is required.");
    }

    const existing = await ctx.db
      .query("customColumns")
      .withIndex("by_column_key", (q) => q.eq("columnKey", args.columnKey))
      .unique();

    if (!existing) {
      throw new Error("Column not found.");
    }

    const allColumns = await ctx.db.query("customColumns").collect();
    const normalizedLabel = label.toLowerCase();
    const duplicate = allColumns.find((column) => column.isActive && column.columnKey !== args.columnKey && column.label.trim().toLowerCase() === normalizedLabel);
    if (duplicate) {
      throw new Error("A column with that name already exists.");
    }

    await ctx.db.patch(existing._id, {
      label,
      updatedAt: Date.now(),
    });

    return toColumnDto(await ctx.db.get(existing._id));
  },
});

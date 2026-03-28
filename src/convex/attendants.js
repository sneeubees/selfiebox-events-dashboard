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

  return user;
}

async function findAttendantById(ctx, attendantId) {
  const attendant = await ctx.db.get(attendantId);
  if (!attendant || attendant.columnKey !== "attendants") {
    throw new Error("Attendant not found.");
  }
  return attendant;
}

function inferTypeLabel(name, contentType) {
  if (contentType) {
    if (contentType.includes("pdf")) return "PDF";
    if (contentType.includes("image")) return "Image";
  }
  const extension = String(name || "").split(".").pop();
  return extension ? extension.toUpperCase() : "File";
}

function formatDateLabel(timestamp) {
  try {
    return new Date(timestamp).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export const listFiles = query({
  args: {
    attendantId: v.id("labelOptions"),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    await findAttendantById(ctx, args.attendantId);
    const rows = await ctx.db
      .query("attendantFiles")
      .withIndex("by_attendant", (q) => q.eq("attendantId", args.attendantId))
      .collect();
    const ordered = rows.sort((left, right) => right.createdAt - left.createdAt);
    return Promise.all(
      ordered.map(async (row) => ({
        id: String(row._id),
        fileCategory: row.fileCategory,
        name: row.name,
        type: inferTypeLabel(row.name, row.contentType),
        size: row.sizeLabel || "",
        uploadedAt: formatDateLabel(row.createdAt),
        url: row.storageId ? ((await ctx.storage.getUrl(row.storageId)) || "") : "",
      }))
    );
  },
});

export const saveFile = mutation({
  args: {
    attendantId: v.id("labelOptions"),
    storageId: v.id("_storage"),
    name: v.string(),
    fileCategory: v.string(),
    contentType: v.optional(v.string()),
    sizeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    await findAttendantById(ctx, args.attendantId);
    const now = Date.now();
    const id = await ctx.db.insert("attendantFiles", {
      attendantId: args.attendantId,
      name: args.name,
      fileCategory: args.fileCategory,
      storageId: args.storageId,
      contentType: args.contentType,
      sizeLabel: args.sizeLabel,
      createdByUserId: currentUser._id,
      createdAt: now,
    });
    return { id: String(id) };
  },
});

export const removeFile = mutation({
  args: {
    fileId: v.id("attendantFiles"),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const row = await ctx.db.get(args.fileId);
    if (!row) {
      return null;
    }
    if (row.storageId) {
      await ctx.storage.delete(row.storageId);
    }
    await ctx.db.delete(args.fileId);
    return String(args.fileId);
  },
});

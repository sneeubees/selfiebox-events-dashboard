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

async function findEventByKey(ctx, eventKey) {
  return ctx.db
    .query("events")
    .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
    .unique();
}

function formatDateLabel(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function abbreviateActivity(eventName, text) {
  const summary = `${eventName}: ${text}`;
  return summary.length > 64 ? `${summary.slice(0, 61)}...` : summary;
}

function inferTypeLabel(name, contentType) {
  if (contentType) {
    if (contentType.includes("pdf")) {
      return "PDF";
    }
    if (contentType.includes("image")) {
      return "Image";
    }
  }

  const extension = String(name || "").split(".").pop();
  return extension ? extension.toUpperCase() : "File";
}

function isPdfFile(name, contentType) {
  return String(contentType || "").toLowerCase().includes("pdf") || /\.pdf$/i.test(String(name || ""));
}

function parseLegacyTimestamp() {
  return Date.now();
}


export const listEventFiles = query({
  args: { eventKey: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      return [];
    }

    const files = await ctx.db
      .query("eventFiles")
      .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
      .collect();

    const results = [];
    for (const entry of files.sort((left, right) => right.createdAt - left.createdAt)) {
      const url = entry.storageId ? await ctx.storage.getUrl(entry.storageId) : null;
      results.push({
        id: String(entry._id),
        name: entry.name,
        type: inferTypeLabel(entry.name, entry.contentType),
        size: entry.sizeLabel || "",
        url: url || "",
        uploadedAt: formatDateLabel(entry.createdAt),
      });
    }

    return results;
  },
});

export const listPdfCandidatesForDocumentNumbers = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").collect();
    const eventKeyById = new Map(events.map((event) => [String(event._id), event.eventKey]));

    const files = await ctx.db.query("eventFiles").collect();
    return files
      .filter((file) => file.storageId && isPdfFile(file.name, file.contentType))
      .map((file) => ({
        id: String(file._id),
        eventKey: eventKeyById.get(String(file.eventId)) || "",
        storageId: file.storageId,
        name: file.name,
        contentType: file.contentType || "",
        createdAt: file.createdAt,
      }))
      .filter((file) => file.eventKey)
      .sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const saveUploadedFile = mutation({
  args: {
    eventKey: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.optional(v.string()),
    sizeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      throw new Error("Event not found.");
    }

    const now = Date.now();
    const fileId = await ctx.db.insert("eventFiles", {
      eventId: eventRecord._id,
      name: args.name,
      storageId: args.storageId,
      contentType: args.contentType,
      sizeLabel: args.sizeLabel,
      createdByUserId: currentUser._id,
      createdAt: now,
    });

    const actorName = currentUser.fullName || currentUser.firstName || currentUser.email;
    const eventName = eventRecord.name || "Untitled event";

    await ctx.db.insert("activityLog", {
      workspaceYear: eventRecord.workspaceYear,
      eventId: eventRecord._id,
      eventName,
      text: `Uploaded file: ${args.name}`,
      shortText: abbreviateActivity(eventName, `Uploaded file: ${args.name}`),
      actorName,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    const url = await ctx.storage.getUrl(args.storageId);
    return {
      id: String(fileId),
      name: args.name,
      type: inferTypeLabel(args.name, args.contentType),
      size: args.sizeLabel || "",
      url: url || "",
      uploadedAt: formatDateLabel(now),
    };
  },
});

export const removeFile = mutation({
  args: {
    fileId: v.id("eventFiles"),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const fileRecord = await ctx.db.get(args.fileId);
    if (!fileRecord) {
      return null;
    }

    const eventRecord = await ctx.db.get(fileRecord.eventId);
    if (!eventRecord) {
      if (fileRecord.storageId) {
        await ctx.storage.delete(fileRecord.storageId);
      }
      await ctx.db.delete(args.fileId);
      return null;
    }

    if (eventRecord.status === "Event Completed") {
      throw new Error("Completed event files can no longer be deleted.");
    }

    if (fileRecord.storageId) {
      await ctx.storage.delete(fileRecord.storageId);
    }
    await ctx.db.delete(args.fileId);

    const now = Date.now();
    const actorName = currentUser.fullName || currentUser.firstName || currentUser.email;
    const eventName = eventRecord.name || "Untitled event";

    await ctx.db.insert("activityLog", {
      workspaceYear: eventRecord.workspaceYear,
      eventId: eventRecord._id,
      eventName,
      text: `Deleted file: ${fileRecord.name}`,
      shortText: abbreviateActivity(eventName, `Deleted file: ${fileRecord.name}`),
      actorName,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    return String(args.fileId);
  },
});


export const migrateLegacyFiles = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);

    const events = await ctx.db.query("events").collect();
    let inserted = 0;

    for (const eventRecord of events) {
      const existingFiles = await ctx.db
        .query("eventFiles")
        .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
        .collect();
      const existingLegacyIds = new Set(existingFiles.map((entry) => entry.legacyFileId).filter(Boolean));

      for (const file of eventRecord.files || []) {
        if (file.id && existingLegacyIds.has(file.id)) {
          continue;
        }

        await ctx.db.insert("eventFiles", {
          eventId: eventRecord._id,
          name: file.name || "Legacy file",
          legacyFileId: file.id || undefined,
          contentType: file.type || undefined,
          sizeLabel: file.size || undefined,
          createdAt: parseLegacyTimestamp(),
        });
        inserted += 1;
      }

      if ((eventRecord.files || []).length) {
        await ctx.db.patch(eventRecord._id, {
          files: [],
          updatedAt: Date.now(),
        });
      }
    }

    return { inserted };
  },
});

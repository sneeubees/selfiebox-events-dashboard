import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function parseLegacyTimestamp(value) {
  if (!value) {
    return Date.now();
  }

  const normalized = String(value).replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function abbreviateActivity(eventName, text) {
  const summary = `${eventName}: ${text}`;
  return summary.length > 64 ? `${summary.slice(0, 61)}...` : summary;
}

function formatDisplayTimestamp(timestamp) {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(timestamp))
      .reduce((accumulator, part) => {
        accumulator[part.type] = part.value;
        return accumulator;
      }, {});
  } catch {
    return null;
  }
}

function formatLogDate(timestamp) {
  const parts = formatDisplayTimestamp(timestamp);
  if (parts) {
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

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

export const listEventUpdates = query({
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

    const updates = await ctx.db
      .query("eventUpdates")
      .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
      .collect();

    return updates
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((entry) => ({
        id: String(entry._id),
        text: entry.body,
        user: entry.actorName,
        date: formatLogDate(entry.createdAt),
      }));
  },
});

export const listEventActivity = query({
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

    const activity = await ctx.db
      .query("activityLog")
      .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
      .collect();

    return activity
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((entry) => ({
        id: String(entry._id),
        text: entry.text,
        user: entry.actorName,
        date: formatLogDate(entry.createdAt),
      }));
  },
});

export const listWorkspaceActivity = query({
  args: { workspaceYear: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(args.limit || 200, 500));
    const activity = await ctx.db
      .query("activityLog")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", args.workspaceYear))
      .order("desc")
      .take(safeLimit);

    const eventIds = Array.from(new Set(activity.map((entry) => entry.eventId).filter(Boolean)));
    const eventPairs = await Promise.all(
      eventIds.map(async (eventId) => [String(eventId), await ctx.db.get(eventId)])
    );
    const eventMap = new Map(eventPairs);

    return activity.map((entry) => ({
      id: String(entry._id),
      text: entry.text,
      shortText: entry.shortText,
      user: entry.actorName,
      date: formatLogDate(entry.createdAt),
      eventName: entry.eventName || "Untitled event",
      eventKey: entry.eventId ? (eventMap.get(String(entry.eventId))?.eventKey || "") : "",
    }));
  },
});

export const addUpdate = mutation({
  args: {
    eventKey: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      throw new Error("Event not found.");
    }

    const now = Date.now();
    const actorName = currentUser.fullName || currentUser.firstName || currentUser.email;
    const eventName = eventRecord.name || "Untitled event";
    const trimmedBody = args.body.trim();
    if (!trimmedBody) {
      throw new Error("Update body is required.");
    }

    const updateId = await ctx.db.insert("eventUpdates", {
      eventId: eventRecord._id,
      body: trimmedBody,
      actorName,
      createdByUserId: currentUser._id,
      createdAt: now,
    });

    await ctx.db.insert("activityLog", {
      workspaceYear: eventRecord.workspaceYear,
      eventId: eventRecord._id,
      eventName,
      text: "Wrote an update.",
      shortText: abbreviateActivity(eventName, "Wrote an update."),
      actorName,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    return {
      id: String(updateId),
      text: trimmedBody,
      user: actorName,
      date: formatLogDate(now),
    };
  },
});

export const logActivity = mutation({
  args: {
    workspaceYear: v.number(),
    eventKey: v.optional(v.string()),
    eventName: v.optional(v.string()),
    text: v.string(),
    shortText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const actorName = currentUser.fullName || currentUser.firstName || currentUser.email;
    const eventRecord = args.eventKey ? await findEventByKey(ctx, args.eventKey) : null;
    const eventName = args.eventName || eventRecord?.name || "Untitled event";
    const now = Date.now();

    const activityId = await ctx.db.insert("activityLog", {
      workspaceYear: args.workspaceYear,
      eventId: eventRecord?._id,
      eventName,
      text: args.text,
      shortText: args.shortText || abbreviateActivity(eventName, args.text),
      actorName,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    return String(activityId);
  },
});

export const migrateLegacyEntries = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);

    const events = await ctx.db.query("events").collect();
    let insertedUpdates = 0;
    let insertedActivity = 0;

    for (const eventRecord of events) {
      const existingUpdates = await ctx.db
        .query("eventUpdates")
        .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
        .collect();
      const existingUpdateLegacyIds = new Set(existingUpdates.map((entry) => entry.legacyEntryId).filter(Boolean));

      for (const entry of eventRecord.updates || []) {
        if (entry.id && existingUpdateLegacyIds.has(entry.id)) {
          continue;
        }

        await ctx.db.insert("eventUpdates", {
          eventId: eventRecord._id,
          body: entry.text || "",
          actorName: entry.user || "Unknown user",
          legacyEntryId: entry.id || undefined,
          createdAt: parseLegacyTimestamp(entry.date),
        });
        insertedUpdates += 1;
      }

      const existingActivity = await ctx.db
        .query("activityLog")
        .withIndex("by_event", (q) => q.eq("eventId", eventRecord._id))
        .collect();
      const existingActivityLegacyIds = new Set(existingActivity.map((entry) => entry.legacyEntryId).filter(Boolean));

      for (const entry of eventRecord.activity || []) {
        if (entry.id && existingActivityLegacyIds.has(entry.id)) {
          continue;
        }

        await ctx.db.insert("activityLog", {
          workspaceYear: eventRecord.workspaceYear,
          eventId: eventRecord._id,
          eventName: eventRecord.name || "Untitled event",
          text: entry.text || "",
          shortText: abbreviateActivity(eventRecord.name || "Untitled event", entry.text || ""),
          actorName: entry.user || "Unknown user",
          legacyEntryId: entry.id || undefined,
          createdAt: parseLegacyTimestamp(entry.date),
        });
        insertedActivity += 1;
      }
    }

    return {
      insertedUpdates,
      insertedActivity,
    };
  },
});

export const deleteFutureActivityEntries = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can clean activity entries.");
    }

    const now = Date.now();
    const activity = await ctx.db.query("activityLog").collect();
    const futureEntries = activity.filter((entry) => entry.createdAt > now);

    for (const entry of futureEntries) {
      await ctx.db.delete(entry._id);
    }

    return {
      deleted: futureEntries.length,
    };
  },
});

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

export const wipeRuntimeData = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can wipe runtime data.");
    }

    const eventFiles = await ctx.db.query("eventFiles").collect();
    let deletedStorageFiles = 0;
    for (const file of eventFiles) {
      if (file.storageId) {
        await ctx.storage.delete(file.storageId);
        deletedStorageFiles += 1;
      }
      await ctx.db.delete(file._id);
    }

    const eventUpdates = await ctx.db.query("eventUpdates").collect();
    for (const update of eventUpdates) {
      await ctx.db.delete(update._id);
    }

    const activityEntries = await ctx.db.query("activityLog").collect();
    for (const entry of activityEntries) {
      await ctx.db.delete(entry._id);
    }

    const events = await ctx.db.query("events").collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }

    return {
      deletedEvents: events.length,
      deletedUpdates: eventUpdates.length,
      deletedActivityEntries: activityEntries.length,
      deletedFileRecords: eventFiles.length,
      deletedStorageFiles,
    };
  },
});

export const runtimeCounts = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").collect();
    const updates = await ctx.db.query("eventUpdates").collect();
    const activity = await ctx.db.query("activityLog").collect();
    const files = await ctx.db.query("eventFiles").collect();

    return {
      events: events.length,
      updates: updates.length,
      activity: activity.length,
      files: files.length,
    };
  },
});

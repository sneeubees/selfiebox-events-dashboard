import { internalQuery } from "./_generated/server";

// wipeRuntimeData (delete every event, update, log entry and stored file) was
// removed on 2026-09-21: nothing in the app called it, and one compromised
// admin login would have been enough to erase the live system. Restore from a
// backup into a scratch backend if a clean slate is ever needed.

// Internal (admin key / CLI only): four full-table scans, the same pattern that
// has crashed the backend before, must not be reachable anonymously.
export const runtimeCounts = internalQuery({
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

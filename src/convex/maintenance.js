import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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

// Internal (admin key / CLI only): bulk-correct the Excl JC column on rows
// tagged ONLY KwaZulu-Natal and/or North West (Johan's request, Nov 2026).
// Any row tagged with another region is refused, and a row is skipped unless
// it still holds the value the caller read (so a newer edit is never
// overwritten). Every change is written to the row's activity log.
const EXCL_JC_ALLOWED_BRANCHES = new Set(["KZN", "NW"]);

export const setRegionalExclJc = internalMutation({
  args: {
    changes: v.array(v.object({
      id: v.id("events"),
      expected: v.string(),
      value: v.string(),
      reason: v.string(),
    })),
    actorName: v.string(),
  },
  handler: async (ctx, args) => {
    const applied = [];
    const skipped = [];
    // Sequential on purpose: Promise.all over ctx.db has crashed this backend.
    for (const change of args.changes) {
      const event = await ctx.db.get(change.id);
      if (!event) { skipped.push({ id: change.id, why: "not found" }); continue; }
      const branches = event.branch || [];
      if (!branches.length || !branches.every((b) => EXCL_JC_ALLOWED_BRANCHES.has(b))) {
        skipped.push({ id: change.id, why: `branch ${branches.join(",")} not KZN/NW only` });
        continue;
      }
      const customFields = event.customFields || {};
      const current = String(customFields.custom_excl_jc || customFields.exclJc || "");
      if (current !== change.expected) {
        skipped.push({ id: change.id, why: `changed since read (now "${current}")` });
        continue;
      }
      await ctx.db.patch(event._id, {
        customFields: { ...customFields, custom_excl_jc: change.value },
        updatedAt: Date.now(),
      });
      const eventName = event.name || "Untitled event";
      const text = `Excl JC ${current || "(blank)"} -> ${change.value} (${change.reason}).`;
      await ctx.db.insert("activityLog", {
        workspaceYear: event.workspaceYear,
        eventId: event._id,
        eventName,
        text,
        shortText: `${eventName}: ${text}`.slice(0, 120),
        actorName: args.actorName,
        createdAt: Date.now(),
      });
      applied.push(change.id);
    }
    return { applied: applied.length, skipped };
  },
});

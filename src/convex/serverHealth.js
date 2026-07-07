import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

// Any approved, active dashboard user may view server health.
async function requireApprovedUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) user = (await ctx.db.query("users").collect()).find((c) => c.email === email) || null;
  }
  // Info & Reporting (incl. Server Health) is admin-only — not even managers.
  if (!user || !user.isApproved || !user.isActive || user.role !== "admin") return null;
  return user;
}

// Called from the /health/ingest http action (secret-guarded there).
export const ingest = internalMutation({
  args: { ts: v.number(), diskPct: v.number(), memPct: v.number(), overallOk: v.boolean(), payload: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("serverHealth", args);
    // Keep ~7 days of 5-minute snapshots.
    const cutoff = args.ts - 7 * 24 * 60 * 60 * 1000;
    const stale = await ctx.db.query("serverHealth").withIndex("by_ts", (q) => q.lt("ts", cutoff)).collect();
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

// Called from the /backup/report http action (secret-guarded there).
export const recordBackup = internalMutation({
  args: { ts: v.number(), ok: v.boolean(), target: v.string(), sizeBytes: v.number(), label: v.string(), detail: v.string(), durationMs: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("serverBackups", args);
    const cutoff = args.ts - 120 * 24 * 60 * 60 * 1000; // keep ~120 days of backup runs
    const stale = await ctx.db.query("serverBackups").withIndex("by_ts", (q) => q.lt("ts", cutoff)).collect();
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireApprovedUser(ctx);
    if (!user) return null;
    const latest = await ctx.db.query("serverHealth").withIndex("by_ts").order("desc").first();
    if (!latest) return null;
    return { ts: latest.ts, diskPct: latest.diskPct, memPct: latest.memPct, overallOk: latest.overallOk, payload: latest.payload };
  },
});

export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireApprovedUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("serverHealth").withIndex("by_ts").order("desc").take(args.limit || 288);
    return rows.map((r) => ({ ts: r.ts, diskPct: r.diskPct, memPct: r.memPct, overallOk: r.overallOk })).reverse();
  },
});

export const getBackups = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireApprovedUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("serverBackups").withIndex("by_ts").order("desc").take(args.limit || 30);
    return rows.map((r) => ({ ts: r.ts, ok: r.ok, target: r.target, sizeBytes: r.sizeBytes, label: r.label, detail: r.detail, durationMs: r.durationMs }));
  },
});

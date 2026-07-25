import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Editable fixed-monthly expenses (Finances > Expenses) + named snapshots so a
// point-in-time reference can be kept before changes (history over years).
// Data shape (both current + snapshots), owned by the frontend:
//   { gauteng: { label, sections: [{ title, items: [[name, amount], ...] }] }, capetown: {...} }
// Admin-only, same access rule as the rest of Info & Reporting.

async function requireAdmin(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = clerkId
    ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique()
    : null;
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) user = (await ctx.db.query("users").collect()).find((u) => u.email === email) || null;
  }
  if (!user || !user.isApproved || !user.isActive || user.role !== "admin") throw new Error("Admins only");
  return user;
}

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    try { await requireAdmin(ctx); } catch { return null; }
    const row = await ctx.db.query("expensesCurrent").first();
    if (!row) return { exists: false, data: null, updatedAt: null };
    return { exists: true, data: row.data, updatedAt: row.updatedAt };
  },
});

export const saveCurrent = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const user = await requireAdmin(ctx);
    const now = Date.now();
    const row = await ctx.db.query("expensesCurrent").first();
    if (row) await ctx.db.patch(row._id, { data, updatedAt: now, updatedByEmail: user.email || "" });
    else await ctx.db.insert("expensesCurrent", { data, updatedAt: now, updatedByEmail: user.email || "" });
    return { ok: true };
  },
});

export const listSnapshots = query({
  args: {},
  handler: async (ctx) => {
    try { await requireAdmin(ctx); } catch { return null; }
    const rows = await ctx.db.query("expenseSnapshots").withIndex("by_created").order("desc").collect();
    return rows.map((r) => ({ id: r._id, name: r.name, createdAt: r.createdAt, createdByEmail: r.createdByEmail || "" }));
  },
});

export const getSnapshot = query({
  args: { id: v.id("expenseSnapshots") },
  handler: async (ctx, { id }) => {
    try { await requireAdmin(ctx); } catch { return null; }
    const row = await ctx.db.get(id);
    if (!row) return null;
    return { id: row._id, name: row.name, createdAt: row.createdAt, data: row.data };
  },
});

export const createSnapshot = mutation({
  args: { name: v.string(), data: v.any() },
  handler: async (ctx, { name, data }) => {
    const user = await requireAdmin(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the reference a name.");
    const id = await ctx.db.insert("expenseSnapshots", {
      name: trimmed, data, createdAt: Date.now(), createdByEmail: user.email || "",
    });
    return { ok: true, id };
  },
});

export const deleteSnapshot = mutation({
  args: { id: v.id("expenseSnapshots") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
    return { ok: true };
  },
});

// ---- Commission ladder config (Finances > Commission) ----
// start = turnover where commission begins, step = bracket size, amount = R per bracket.
const LADDER_DEFAULTS = { start: 350000, step: 50000, amount: 2000 };

export const getCommissionConfig = query({
  args: {},
  handler: async (ctx) => {
    try { await requireAdmin(ctx); } catch { return null; }
    const row = await ctx.db.query("commissionConfig").first();
    return row ? { start: row.start, step: row.step, amount: row.amount } : { ...LADDER_DEFAULTS };
  },
});

export const saveCommissionConfig = mutation({
  args: { start: v.number(), step: v.number(), amount: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.start <= 0 || args.step <= 0 || args.amount <= 0) throw new Error("All ladder values must be positive.");
    const row = await ctx.db.query("commissionConfig").first();
    const doc = { start: args.start, step: args.step, amount: args.amount, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("commissionConfig", doc);
    return { ok: true };
  },
});

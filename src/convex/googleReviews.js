import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";

async function admin(ctx, subject, email) {
  let user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", subject)).unique();
  if (!user && email) user = (await ctx.db.query("users").collect()).find(u => u.email === email.toLowerCase());
  if (!user?.isApproved || !user?.isActive || user.role !== "admin") throw new Error("Admins only");
  return user;
}
async function currentAdmin(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return admin(ctx, identity.subject ?? identity.tokenIdentifier, identity.email || "");
}
const integration = ctx => ctx.db.query("integrations").withIndex("by_key", q => q.eq("key", "googleReviews")).unique();

export const status = query({
  args: {},
  handler: async ctx => {
    await currentAdmin(ctx);
    const row = await integration(ctx);
    return { connected: Boolean(row), connectedAt: row?.connectedAt || null,
      configured: Boolean((process.env.GBP_OAUTH_CLIENT_ID || process.env.GA4_OAUTH_CLIENT_ID) &&
        (process.env.GBP_OAUTH_CLIENT_SECRET || process.env.GA4_OAUTH_CLIENT_SECRET) && process.env.GBP_REDIRECT_URI),
      redirectUri: process.env.GBP_REDIRECT_URI || "" };
  },
});
export const authorise = internalQuery({
  args: { subject: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const user = await admin(ctx, args.subject, args.email);
    const row = await integration(ctx);
    return { refreshToken: row?.refreshToken || null, userId: user._id };
  },
});
export const saveState = internalMutation({
  args: { digest: v.string(), verifier: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("googleReviewOAuthStates").withIndex("by_user", q => q.eq("userId", args.userId)).collect();
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert("googleReviewOAuthStates", { ...args, expiresAt: Date.now() + 10 * 60 * 1000 });
  },
});
export const consumeState = internalMutation({
  args: { digest: v.string() },
  handler: async (ctx, { digest }) => {
    const row = await ctx.db.query("googleReviewOAuthStates").withIndex("by_digest", q => q.eq("digest", digest)).unique();
    if (!row) throw new Error("Connection expired. Start again from Google Reviews.");
    await ctx.db.delete(row._id);
    const user = await ctx.db.get(row.userId);
    if (row.expiresAt < Date.now() || !user?.isActive || !user?.isApproved || user.role !== "admin")
      throw new Error("Connection expired. Start again from Google Reviews.");
    return { verifier: row.verifier, userId: row.userId };
  },
});
export const saveToken = internalMutation({
  args: { refreshToken: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user?.isActive || !user?.isApproved || user.role !== "admin") throw new Error("Admins only");
    const row = await integration(ctx);
    const data = { refreshToken: args.refreshToken, connectedByEmail: user.email || "", updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, data);
    else await ctx.db.insert("integrations", { ...data, key: "googleReviews", connectedAt: Date.now() });
  },
});
export const disconnect = mutation({
  args: {},
  handler: async ctx => {
    await currentAdmin(ctx);
    const row = await integration(ctx);
    if (row) await ctx.db.delete(row._id);
    // Invalidate pending callbacks so disconnect cannot be undone by an old tab.
    for (const state of await ctx.db.query("googleReviewOAuthStates").collect()) await ctx.db.delete(state._id);
  },
});

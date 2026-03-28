import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const COMMISSION_RATES_SINGLETON_KEY = "default";
const DEFAULT_COMMISSION_RATES = {
  twoHours: 500,
  threeHours: 550,
  fourHours: 600,
  fiveHours: 650,
  sixPlusHours: 1000,
  perKmRate: 3,
};

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

async function requireCommissionUser(ctx) {
  const user = await requireCurrentUser(ctx);
  if (!["admin", "manager"].includes(user.role)) {
    throw new Error("Only admins and managers can manage commission exports.");
  }
  return user;
}

async function requireAdminUser(ctx) {
  const user = await requireCurrentUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Only admins can manage commission exports.");
  }
  return user;
}

function toRatesDto(row) {
  return {
    twoHours: typeof row?.twoHours === "number" ? row.twoHours : DEFAULT_COMMISSION_RATES.twoHours,
    threeHours: typeof row?.threeHours === "number" ? row.threeHours : DEFAULT_COMMISSION_RATES.threeHours,
    fourHours: typeof row?.fourHours === "number" ? row.fourHours : DEFAULT_COMMISSION_RATES.fourHours,
    fiveHours: typeof row?.fiveHours === "number" ? row.fiveHours : DEFAULT_COMMISSION_RATES.fiveHours,
    sixPlusHours: typeof row?.sixPlusHours === "number" ? row.sixPlusHours : DEFAULT_COMMISSION_RATES.sixPlusHours,
    perKmRate: typeof row?.perKmRate === "number" ? row.perKmRate : DEFAULT_COMMISSION_RATES.perKmRate,
    updatedAt: row?.updatedAt || 0,
  };
}

export const getRates = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const row = await ctx.db
      .query("commissionRates")
      .withIndex("by_singleton_key", (q) => q.eq("singletonKey", COMMISSION_RATES_SINGLETON_KEY))
      .unique();
    return toRatesDto(row);
  },
});

export const saveRates = mutation({
  args: {
    twoHours: v.number(),
    threeHours: v.number(),
    fourHours: v.number(),
    fiveHours: v.number(),
    sixPlusHours: v.number(),
    perKmRate: v.number(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAdminUser(ctx);
    const existing = await ctx.db
      .query("commissionRates")
      .withIndex("by_singleton_key", (q) => q.eq("singletonKey", COMMISSION_RATES_SINGLETON_KEY))
      .unique();

    const payload = {
      singletonKey: COMMISSION_RATES_SINGLETON_KEY,
      twoHours: Math.max(0, Number(args.twoHours) || 0),
      threeHours: Math.max(0, Number(args.threeHours) || 0),
      fourHours: Math.max(0, Number(args.fourHours) || 0),
      fiveHours: Math.max(0, Number(args.fiveHours) || 0),
      sixPlusHours: Math.max(0, Number(args.sixPlusHours) || 0),
      perKmRate: Math.max(0, Number(args.perKmRate) || 0),
      updatedAt: Date.now(),
      updatedByUserId: currentUser._id,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return toRatesDto(await ctx.db.get(existing._id));
    }

    const id = await ctx.db.insert("commissionRates", payload);
    return toRatesDto(await ctx.db.get(id));
  },
});

export const saveSnapshot = mutation({
  args: {
    month: v.string(),
    year: v.number(),
    period: v.string(),
    attendant: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCommissionUser(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("commissionSnapshots", {
      month: args.month,
      year: args.year,
      period: args.period,
      attendant: args.attendant,
      storageId: args.storageId,
      fileName: args.fileName,
      createdAt: now,
      createdByUserId: currentUser._id,
    });
    return { id };
  },
});

export const listSnapshots = query({
  args: {
    month: v.string(),
    year: v.number(),
    attendant: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCommissionUser(ctx);
    const rows = await ctx.db
      .query("commissionSnapshots")
      .withIndex("by_month_attendant", (q) => q.eq("year", args.year).eq("month", args.month).eq("attendant", args.attendant))
      .collect();

    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((record) => [String(record._id), record]));

    const enriched = await Promise.all(rows.map(async (row) => ({
      id: row._id,
      fileName: row.fileName,
      period: row.period,
      createdAt: row.createdAt,
      url: (await ctx.storage.getUrl(row.storageId)) || "",
      createdByLabel: row.createdByUserId ? (userById.get(String(row.createdByUserId))?.fullName || "") : "",
    })));

    return enriched.sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const saveSummarySnapshot = mutation({
  args: {
    month: v.string(),
    year: v.number(),
    period: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCommissionUser(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("commissionSummarySnapshots", {
      month: args.month,
      year: args.year,
      period: args.period,
      storageId: args.storageId,
      fileName: args.fileName,
      createdAt: now,
      createdByUserId: currentUser._id,
    });
    return { id };
  },
});

export const listSummarySnapshots = query({
  args: {
    month: v.string(),
    year: v.number(),
    period: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCommissionUser(ctx);
    const rows = await ctx.db
      .query("commissionSummarySnapshots")
      .withIndex("by_month_period", (q) => q.eq("year", args.year).eq("month", args.month).eq("period", args.period))
      .collect();
    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((record) => [String(record._id), record]));
    const enriched = await Promise.all(rows.map(async (row) => ({
      id: row._id,
      fileName: row.fileName,
      createdAt: row.createdAt,
      url: (await ctx.storage.getUrl(row.storageId)) || "",
      createdByLabel: row.createdByUserId ? (userById.get(String(row.createdByUserId))?.fullName || "") : "",
    })));
    return enriched.sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const listOverrides = query({
  args: {
    month: v.string(),
    year: v.number(),
    attendant: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCommissionUser(ctx);
    const rows = await ctx.db
      .query("commissionOverrides")
      .withIndex("by_month_attendant", (q) => q.eq("year", args.year).eq("month", args.month).eq("attendant", args.attendant))
      .collect();

    return rows.map((row) => ({
      id: row._id,
      eventId: row.eventId,
      hoursPayable: row.hoursPayable || "",
      amount: row.amount || "",
      car: row.car || "",
      km: row.km || "",
      note: row.note || "",
      updatedAt: row.updatedAt,
    }));
  },
});

export const saveOverride = mutation({
  args: {
    month: v.string(),
    year: v.number(),
    attendant: v.string(),
    eventId: v.string(),
    hoursPayable: v.optional(v.string()),
    amount: v.optional(v.string()),
    car: v.optional(v.string()),
    km: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCommissionUser(ctx);
    const existing = await ctx.db
      .query("commissionOverrides")
      .withIndex("by_month_attendant_event", (q) =>
        q
          .eq("year", args.year)
          .eq("month", args.month)
          .eq("attendant", args.attendant)
          .eq("eventId", args.eventId)
      )
      .unique();

    const nextValues = {
      hoursPayable: String(args.hoursPayable || ""),
      amount: String(args.amount || ""),
      car: String(args.car || ""),
      km: String(args.km || ""),
      note: String(args.note || ""),
    };
    const hasAnyValue = Object.values(nextValues).some((value) => value.trim() !== "");

    if (!hasAnyValue) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return { id: existing?._id || null, removed: true };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...nextValues,
        updatedAt: Date.now(),
        updatedByUserId: currentUser._id,
      });
      return { id: existing._id, removed: false };
    }

    const id = await ctx.db.insert("commissionOverrides", {
      month: args.month,
      year: args.year,
      attendant: args.attendant,
      eventId: args.eventId,
      ...nextValues,
      updatedAt: Date.now(),
      updatedByUserId: currentUser._id,
    });
    return { id, removed: false };
  },
});

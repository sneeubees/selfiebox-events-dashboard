import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function requireAdminUser(ctx) {
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
  if (user.role !== "admin") {
    throw new Error("Only admins can access turnover history.");
  }

  return user;
}

const MONTH_KEYS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const GP_BRANCHES = new Set(["GP", "GAUTENG"]);
const CT_BRANCHES = new Set(["CT", "CAPE TOWN", "CAPETOWN"]);

function normalizeBranchValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseMonthKey(dateValue) {
  const text = String(dateValue || "").trim();
  if (!text) {
    return "";
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return MONTH_KEYS[parsed.getMonth()] || "";
}

function parseAmount(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const sanitized = text.replace(/[R\s]/gi, "");
  if (!sanitized) {
    return 0;
  }

  const hasComma = sanitized.includes(",");
  const hasDot = sanitized.includes(".");

  if (hasComma && hasDot) {
    const normalized = sanitized.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (hasComma) {
    const normalized = sanitized.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createYearBucket() {
  return {
    months: Object.fromEntries(MONTH_KEYS.map((month) => [month, 0])),
    total: 0,
    noEvents: 0,
  };
}

function isCompletedStatus(status) {
  return String(status || "").trim().toLowerCase() === "event completed";
}

function addToRegionYear(target, year, month, amount, completed) {
  if (!target[year]) {
    target[year] = createYearBucket();
  }
  if (month) {
    target[year].months[month] = (target[year].months[month] || 0) + amount;
  }
  target[year].total += amount;
  if (completed) {
    target[year].noEvents += 1;
  }
}

export const getLiveTurnover = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);

    const events = await ctx.db.query("events").collect();
    const grouped = {
      gp: {},
      ct: {},
      combined: {},
    };
    const noEventsOverrides = await ctx.db.query("turnoverNoEventsOverrides").collect();
    const overrides = Object.fromEntries(
      noEventsOverrides.map((entry) => [`${entry.regionKey}:${entry.year}`, entry.noEvents])
    );

    events.forEach((event) => {
      const year = Number(event.workspaceYear || 0);
      if (!Number.isFinite(year) || year < 2026) {
        return;
      }

      const month = parseMonthKey(event.date);
      const amount = parseAmount(event.customFields?.custom_excl_jc || event.customFields?.exclJc || "");
      const branchValues = Array.isArray(event.branch) ? event.branch.map(normalizeBranchValue) : [];
      const isGp = branchValues.some((value) => GP_BRANCHES.has(value));
      const isCt = branchValues.some((value) => CT_BRANCHES.has(value));
      const completed = isCompletedStatus(event.status);

      if (isGp) {
        addToRegionYear(grouped.gp, year, month, amount, completed);
      }
      if (isCt) {
        addToRegionYear(grouped.ct, year, month, amount, completed);
      }
      if (isGp || isCt) {
        addToRegionYear(grouped.combined, year, month, amount, completed);
      }
    });

    return {
      regions: grouped,
      overrides,
    };
  },
});

export const saveNoEventsOverride = mutation({
  args: {
    regionKey: v.string(),
    year: v.number(),
    noEvents: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireAdminUser(ctx);
    const regionKey = String(args.regionKey || "").trim().toLowerCase();
    if (!["gp", "ct", "combined"].includes(regionKey)) {
      throw new Error("Invalid turnover region.");
    }
    if (!Number.isFinite(args.year) || args.year >= 2026) {
      throw new Error("Only previous years can be edited.");
    }
    const existing = await ctx.db
      .query("turnoverNoEventsOverrides")
      .withIndex("by_region_year", (q) => q.eq("regionKey", regionKey).eq("year", args.year))
      .unique();
    const payload = {
      regionKey,
      year: args.year,
      noEvents: Math.max(0, Math.trunc(args.noEvents || 0)),
      updatedAt: Date.now(),
      updatedByUserId: user._id,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("turnoverNoEventsOverrides", payload);
  },
});

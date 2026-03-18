import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { PAYMENT_OPTIONS, PAYMENT_STYLES, PRODUCT_OPTIONS, PRODUCT_STYLES, seedEvents, STATUS_OPTIONS, STATUS_STYLES } from "../seedData";

const defaultBranchOptions = [
  { optionKey: "CT", name: "Cape Town", abbreviation: "CT", color: "#d7e5f5", order: 0 },
  { optionKey: "KZN", name: "KwaZulu-Natal", abbreviation: "KZN", color: "#ffe1b8", order: 1 },
  { optionKey: "GP", name: "Gauteng", abbreviation: "GP", color: "#c8ddf7", order: 2 },
];

const defaultProductOptions = PRODUCT_OPTIONS.map((fullName, index) => ({
  optionKey: fullName,
  name: fullName,
  abbreviation: abbreviateLabel(fullName),
  color: PRODUCT_STYLES[fullName]?.background || "#d9edf8",
  order: index,
}));

const defaultStatusOptions = STATUS_OPTIONS.map((name, index) => ({
  optionKey: name,
  name,
  color: STATUS_STYLES[name]?.background || "#d6d6d6",
  order: index,
}));

const defaultPaymentOptions = PAYMENT_OPTIONS.map((name, index) => ({
  optionKey: name,
  name,
  color: PAYMENT_STYLES[name]?.background || "#d6d6d6",
  order: index,
}));

const yesNoColumns = ["vinyl", "gsAi", "imagesSent", "snappic"];
const defaultYesNoOptions = [
  { optionKey: "Yes", name: "Yes", color: "#2fc26d", order: 0 },
  { optionKey: "No", name: "No", color: "#d93c56", order: 1 },
];

const defaultAttendantOptions = Array.from(new Set(seedEvents.flatMap((event) => event.attendants || []))).map((fullName, index) => ({
  optionKey: fullName,
  name: fullName,
  branchKey: "",
  color: "#dfe7f6",
  order: index,
}));

function abbreviateLabel(value) {
  return (value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 7)
    .toUpperCase();
}

function toLabelDto(record) {
  return {
    id: record._id,
    columnKey: record.columnKey,
    optionKey: record.optionKey,
    name: record.name,
    abbreviation: record.abbreviation || "",
    branchKey: record.branchKey || "",
    color: record.color,
    order: record.order,
  };
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isArrayColumn(columnKey) {
  return ["branch", "products", "attendants"].includes(columnKey);
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

function defaultOptionsByColumn() {
  return {
    branch: defaultBranchOptions,
    products: defaultProductOptions,
    status: defaultStatusOptions,
    paymentStatus: defaultPaymentOptions,
    vinyl: defaultYesNoOptions,
    gsAi: defaultYesNoOptions,
    imagesSent: defaultYesNoOptions,
    snappic: defaultYesNoOptions,
    attendants: defaultAttendantOptions,
  };
}

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const options = await ctx.db.query("labelOptions").collect();
    return options
      .filter((option) => option.isActive)
      .sort((left, right) => {
        if (left.columnKey === right.columnKey) {
          return left.order - right.order;
        }
        return left.columnKey.localeCompare(right.columnKey);
      })
      .map(toLabelDto);
  },
});

export const seedInitialData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const existing = await ctx.db.query("labelOptions").take(1);
    if (existing.length) {
      return { inserted: 0, alreadySeeded: true };
    }

    let inserted = 0;
    for (const [columnKey, options] of Object.entries(defaultOptionsByColumn())) {
      for (const option of options) {
        await ctx.db.insert("labelOptions", {
          columnKey,
          optionKey: option.optionKey,
          name: option.name,
          abbreviation: option.abbreviation || "",
          branchKey: option.branchKey || "",
          color: option.color,
          order: option.order,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        inserted += 1;
      }
    }

    return { inserted, alreadySeeded: false };
  },
});

export const migrateLegacyProductKeys = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const products = await ctx.db
      .query("labelOptions")
      .withIndex("by_column", (q) => q.eq("columnKey", "products"))
      .collect();

    for (const product of products) {
      if (product.optionKey !== product.name) {
        await ctx.db.patch(product._id, {
          optionKey: product.name,
          updatedAt: Date.now(),
        });
      }
    }

    return { migrated: products.length };
  },
});

export const cleanupDuplicates = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const allOptions = await ctx.db.query("labelOptions").collect();
    const allEvents = await ctx.db.query("events").collect();
    const columns = ["branch", "products", "status", "paymentStatus", "vinyl", "gsAi", "imagesSent", "snappic", "attendants"];
    let removed = 0;
    let touchedEvents = 0;

    const eventsById = new Map(allEvents.map((event) => [event._id, event]));

    for (const columnKey of columns) {
      const options = allOptions
        .filter((option) => option.columnKey === columnKey)
        .sort((left, right) => left.order - right.order || left._creationTime - right._creationTime);

      const canonicalByName = new Map();
      const canonicalByAbbrev = new Map();
      const valueRemap = new Map();
      const duplicates = [];

      for (const option of options) {
        const nameKey = normalizeValue(option.name);
        const abbrevValue = columnKey === "branch" || columnKey === "products" ? (option.abbreviation || option.optionKey || option.name) : option.name;
        const abbrevKey = normalizeValue(abbrevValue);
        const canonical = canonicalByName.get(nameKey) || ((columnKey === "branch" || columnKey === "products") ? canonicalByAbbrev.get(abbrevKey) : null);

        if (!canonical) {
          canonicalByName.set(nameKey, option);
          if (columnKey === "branch" || columnKey === "products") {
            canonicalByAbbrev.set(abbrevKey, option);
          }
          continue;
        }

        duplicates.push(option);
        const canonicalValue = columnKey === "branch" || columnKey === "products"
          ? (canonical.abbreviation || canonical.optionKey || canonical.name)
          : canonical.name;
        const duplicateValue = columnKey === "branch" || columnKey === "products"
          ? (option.abbreviation || option.optionKey || option.name)
          : option.name;

        if (duplicateValue !== canonicalValue) {
          valueRemap.set(duplicateValue, canonicalValue);
        }
      }

      if (valueRemap.size) {
        for (const [eventId, event] of eventsById.entries()) {
          let changed = false;
          const nextEvent = { ...event };

          if (isArrayColumn(columnKey)) {
            const currentValues = Array.isArray(event[columnKey]) ? event[columnKey] : [];
            const mappedValues = uniqueList(currentValues.map((item) => valueRemap.get(item) || item));
            if (JSON.stringify(mappedValues) !== JSON.stringify(currentValues)) {
              nextEvent[columnKey] = mappedValues;
              changed = true;
            }
          } else {
            const currentValue = event[columnKey] || "";
            const mappedValue = valueRemap.get(currentValue) || currentValue;
            if (mappedValue !== currentValue) {
              nextEvent[columnKey] = mappedValue;
              changed = true;
            }
          }

          if (changed) {
            await ctx.db.patch(eventId, {
              [columnKey]: nextEvent[columnKey],
              updatedAt: Date.now(),
            });
            eventsById.set(eventId, nextEvent);
            touchedEvents += 1;
          }
        }
      }

      for (const duplicate of duplicates) {
        await ctx.db.delete(duplicate._id);
        removed += 1;
      }
    }

    return { removed, touchedEvents };
  },
});

export const upsert = mutation({
  args: {
    columnKey: v.string(),
    optionKey: v.string(),
    name: v.string(),
    abbreviation: v.optional(v.string()),
    branchKey: v.optional(v.string()),
    color: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("labelOptions")
      .withIndex("by_column_option_key", (q) => q.eq("columnKey", args.columnKey).eq("optionKey", args.optionKey))
      .unique();

    const columnOptions = await ctx.db
      .query("labelOptions")
      .withIndex("by_column", (q) => q.eq("columnKey", args.columnKey))
      .collect();
    const otherOptions = columnOptions.filter((option) => option.optionKey !== args.optionKey);
    const duplicateName = otherOptions.some((option) => normalizeValue(option.name) === normalizeValue(args.name));
    if (duplicateName) {
      throw new Error("An item with that name already exists.");
    }

    if (["branch", "products"].includes(args.columnKey)) {
      const duplicateAbbreviation = otherOptions.some((option) => normalizeValue(option.abbreviation || option.optionKey) === normalizeValue(args.abbreviation || args.optionKey));
      if (duplicateAbbreviation) {
        throw new Error("An item with that abbreviation already exists.");
      }
    }

    const payload = {
      columnKey: args.columnKey,
      optionKey: args.optionKey,
      name: args.name,
      abbreviation: args.abbreviation || "",
      branchKey: args.branchKey || "",
      color: args.color,
      order: args.order,
      isActive: true,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return toLabelDto(await ctx.db.get(existing._id));
    }

    const id = await ctx.db.insert("labelOptions", {
      ...payload,
      createdAt: Date.now(),
    });

    return toLabelDto(await ctx.db.get(id));
  },
});

export const remove = mutation({
  args: {
    columnKey: v.string(),
    optionKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("labelOptions")
      .withIndex("by_column_option_key", (q) => q.eq("columnKey", args.columnKey).eq("optionKey", args.optionKey))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    return args.optionKey;
  },
});

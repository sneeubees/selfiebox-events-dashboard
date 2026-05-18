import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { PAYMENT_OPTIONS, PAYMENT_STYLES, PRODUCT_OPTIONS, PRODUCT_STYLES, seedEvents, STATUS_OPTIONS, STATUS_STYLES } from "../seedData";

const defaultBranchOptions = [
  { optionKey: "CT", name: "Cape Town", abbreviation: "CT", color: "#d7e5f5", email: "", address: "", addressPlaceId: "", addressLat: null, addressLng: null, order: 0 },
  { optionKey: "KZN", name: "KwaZulu-Natal", abbreviation: "KZN", color: "#ffe1b8", email: "", address: "", addressPlaceId: "", addressLat: null, addressLng: null, order: 1 },
  { optionKey: "GP", name: "Gauteng", abbreviation: "GP", color: "#c8ddf7", email: "", address: "", addressPlaceId: "", addressLat: null, addressLng: null, order: 2 },
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
  displayName: fullName,
  firstName: "",
  lastName: "",
  cellNumber: "",
  branchKey: "",
  vehicleMake: "",
  vehicleColor: "",
  vehicleNumberPlate: "",
  isFullTimeEmployee: false,
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
      displayName: record.displayName || record.name || "",
      firstName: record.firstName || "",
      lastName: record.lastName || "",
      cellNumber: record.cellNumber || "",
      abbreviation: record.abbreviation || "",
      branchKey: record.branchKey || "",
      vehicleMake: record.vehicleMake || "",
      vehicleColor: record.vehicleColor || "",
      vehicleNumberPlate: record.vehicleNumberPlate || "",
      email: record.email || "",
      address: record.address || "",
      addressPlaceId: record.addressPlaceId || "",
      addressLat: typeof record.addressLat === "number" ? record.addressLat : null,
      addressLng: typeof record.addressLng === "number" ? record.addressLng : null,
      isFullTimeEmployee: Boolean(record.isFullTimeEmployee),
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
  let user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();

  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) {
      user = (await ctx.db.query("users").collect()).find((candidate) => candidate.email === email) || null;
    }
  }

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
    accounts: defaultPaymentOptions,
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
    const existingOptions = await ctx.db.query("labelOptions").collect();
    const existingKeys = new Set(existingOptions.map((option) => `${option.columnKey}::${option.optionKey}`));
    let inserted = 0;
    for (const [columnKey, options] of Object.entries(defaultOptionsByColumn())) {
      for (const option of options) {
        const uniqueKey = `${columnKey}::${option.optionKey}`;
        if (existingKeys.has(uniqueKey)) {
          continue;
        }
        await ctx.db.insert("labelOptions", {
          columnKey,
          optionKey: option.optionKey,
            name: option.name,
            displayName: option.displayName || option.name,
            firstName: option.firstName || "",
            lastName: option.lastName || "",
            cellNumber: option.cellNumber || "",
            abbreviation: option.abbreviation || "",
            branchKey: option.branchKey || "",
            vehicleMake: option.vehicleMake || "",
            vehicleColor: option.vehicleColor || "",
            vehicleNumberPlate: option.vehicleNumberPlate || "",
            email: option.email || "",
            address: option.address || "",
            addressPlaceId: option.addressPlaceId || "",
            addressLat: typeof option.addressLat === "number" ? option.addressLat : null,
            addressLng: typeof option.addressLng === "number" ? option.addressLng : null,
            isFullTimeEmployee: Boolean(option.isFullTimeEmployee),
            color: option.color,
            order: option.order,
            isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        existingKeys.add(uniqueKey);
        inserted += 1;
      }
    }

    return { inserted, alreadySeeded: inserted === 0 };
  },
});

export const migrateLegacyProductKeys = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return { migrated: 0, skipped: true };
  },
});

export const cleanupDuplicates = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return { removed: 0, touchedEvents: 0, skipped: true };
  },
});

export const upsert = mutation({
  args: {
    columnKey: v.string(),
    optionKey: v.string(),
    name: v.string(),
    displayName: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    cellNumber: v.optional(v.string()),
    abbreviation: v.optional(v.string()),
    branchKey: v.optional(v.string()),
    vehicleMake: v.optional(v.string()),
    vehicleColor: v.optional(v.string()),
    vehicleNumberPlate: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    addressPlaceId: v.optional(v.string()),
    addressLat: v.optional(v.union(v.number(), v.null())),
    addressLng: v.optional(v.union(v.number(), v.null())),
    isFullTimeEmployee: v.optional(v.boolean()),
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
      displayName: args.displayName || args.name,
      firstName: args.firstName || "",
      lastName: args.lastName || "",
      cellNumber: args.cellNumber || "",
      abbreviation: args.abbreviation || "",
      branchKey: args.branchKey || "",
      vehicleMake: args.vehicleMake || "",
      vehicleColor: args.vehicleColor || "",
      vehicleNumberPlate: args.vehicleNumberPlate || "",
      email: args.email || "",
      address: args.address || "",
      addressPlaceId: args.addressPlaceId || "",
      addressLat: typeof args.addressLat === "number" ? args.addressLat : null,
      addressLng: typeof args.addressLng === "number" ? args.addressLng : null,
      isFullTimeEmployee: Boolean(args.isFullTimeEmployee),
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

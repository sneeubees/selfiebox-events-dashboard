import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { seedEvents } from "../seedData";

function abbreviateLabel(value) {
  return (value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 7)
    .toUpperCase();
}

function normalizeSeedEvent(event) {
  const workspaceYear = event.date ? new Date(event.date).getFullYear() : event.workspaceYear || 2026;
  return {
    eventKey: event.id,
    workspaceYear,
    name: event.name || "",
    eventTitle: event.eventTitle || "",
    date: event.date || "",
    draftMonth: event.draftMonth || "",
    hours: event.hours || "",
    branch: event.branch || [],
    products: (event.products || []).map((product) => abbreviateLabel(product)),
    status: event.status || "",
    location: event.location || "",
    locationPlaceId: event.locationPlaceId || "",
    locationLat: typeof event.locationLat === 'number' ? event.locationLat : undefined,
    locationLng: typeof event.locationLng === 'number' ? event.locationLng : undefined,
    paymentStatus: event.paymentStatus || "",
    accounts: event.accounts || "",
    quoteNumber: event.quoteNumber || "",
    invoiceNumber: event.invoiceNumber || "",
    exVatAuto: event.exVatAuto ?? "",
    vinyl: event.vinyl || "",
    gsAi: event.gsAi || "",
    imagesSent: event.imagesSent || "",
    snappic: event.snappic || "",
    attendants: event.attendants || [],
    exVat: event.exVat ?? "",
    packageOnly: event.packageOnly || "",
    notes: event.notes || "",
    customFields: event.customFields || {},
    updates: event.updates || [],
    files: event.files || [],
    activity: event.activity || [],
  };
}

function toEventDto(record, creator = null) {
  return {
    id: record.eventKey,
    workspaceYear: record.workspaceYear,
    name: record.name,
    eventTitle: record.eventTitle || "",
    date: record.date || "",
    draftMonth: record.draftMonth || "",
    hours: record.hours || "",
    branch: record.branch || [],
    products: record.products || [],
    status: record.status || "",
    location: record.location || "",
    locationPlaceId: record.locationPlaceId || "",
    locationLat: typeof record.locationLat === 'number' ? record.locationLat : null,
    locationLng: typeof record.locationLng === 'number' ? record.locationLng : null,
    paymentStatus: record.paymentStatus || "",
    accounts: record.accounts || "",
    quoteNumber: record.quoteNumber || "",
    invoiceNumber: record.invoiceNumber || "",
    exVatAuto: record.exVatAuto ?? "",
    vinyl: record.vinyl || "",
    gsAi: record.gsAi || "",
    imagesSent: record.imagesSent || "",
    snappic: record.snappic || "",
    attendants: record.attendants || [],
    exVat: record.exVat ?? "",
    packageOnly: record.packageOnly || "",
    notes: record.notes || "",
    customFields: record.customFields || {},
    updates: record.updates || [],
    files: record.files || [],
    activity: record.activity || [],
    createdByUserId: record.createdByUserId || null,
    createdByName: creator?.fullName || "",
    createdByProfilePic: creator?.profilePic || "",
  };
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

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const events = await ctx.db.query("events").collect();
    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((record) => [String(record._id), record]));
    return events
      .sort((left, right) => String(left.eventKey).localeCompare(String(right.eventKey)))
      .map((record) => toEventDto(record, userById.get(String(record.createdByUserId || "")) || null));
  },
});

export const seedInitialData = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireCurrentUser(ctx);
    const existing = await ctx.db.query("events").take(1);
    if (existing.length) {
      return { inserted: 0, alreadySeeded: true };
    }

    let inserted = 0;
    for (const seedEvent of seedEvents) {
      const event = normalizeSeedEvent(seedEvent);
      await ctx.db.insert("events", {
        ...event,
        createdByUserId: currentUser._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      inserted += 1;
    }

    return { inserted, alreadySeeded: false };
  },
});

export const upsert = mutation({
  args: {
    event: v.object({
      id: v.string(),
      workspaceYear: v.number(),
      name: v.string(),
      eventTitle: v.optional(v.string()),
      date: v.optional(v.string()),
      draftMonth: v.optional(v.string()),
      hours: v.optional(v.string()),
      branch: v.array(v.string()),
      products: v.array(v.string()),
      status: v.optional(v.string()),
      location: v.optional(v.string()),
      locationPlaceId: v.optional(v.string()),
      locationLat: v.optional(v.union(v.number(), v.null())),
      locationLng: v.optional(v.union(v.number(), v.null())),
      paymentStatus: v.optional(v.string()),
      accounts: v.optional(v.string()),
      quoteNumber: v.optional(v.string()),
      invoiceNumber: v.optional(v.string()),
      exVatAuto: v.optional(v.union(v.number(), v.string())),
      vinyl: v.optional(v.string()),
      gsAi: v.optional(v.string()),
      imagesSent: v.optional(v.string()),
      snappic: v.optional(v.string()),
      attendants: v.array(v.string()),
      exVat: v.optional(v.union(v.number(), v.string())),
      packageOnly: v.optional(v.string()),
      notes: v.optional(v.string()),
      customFields: v.optional(v.record(v.string(), v.union(v.string(), v.array(v.string())))),
      updates: v.array(v.object({
        id: v.string(),
        text: v.string(),
        user: v.string(),
        date: v.string(),
      })),
      files: v.array(v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        size: v.string(),
      })),
      activity: v.array(v.object({
        id: v.string(),
        text: v.string(),
        user: v.string(),
        date: v.string(),
      })),
    }),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.event.id))
      .unique();
    const deletedMarker = await ctx.db
      .query("deletedEventKeys")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.event.id))
      .unique();

    const payload = {
      eventKey: args.event.id,
      workspaceYear: args.event.workspaceYear,
      name: args.event.name,
      eventTitle: args.event.eventTitle || "",
      date: args.event.date || "",
      draftMonth: args.event.draftMonth || "",
      hours: args.event.hours || "",
      branch: args.event.branch || [],
      products: args.event.products || [],
      status: args.event.status || "",
      location: args.event.location || "",
      locationPlaceId: args.event.locationPlaceId || "",
      locationLat: typeof args.event.locationLat === 'number' ? args.event.locationLat : undefined,
      locationLng: typeof args.event.locationLng === 'number' ? args.event.locationLng : undefined,
      paymentStatus: args.event.paymentStatus || "",
      accounts: args.event.accounts || "",
      quoteNumber: args.event.quoteNumber || "",
      invoiceNumber: args.event.invoiceNumber || "",
      exVatAuto: args.event.exVatAuto ?? "",
      vinyl: args.event.vinyl || "",
      gsAi: args.event.gsAi || "",
      imagesSent: args.event.imagesSent || "",
      snappic: args.event.snappic || "",
      attendants: args.event.attendants || [],
      exVat: args.event.exVat ?? "",
      packageOnly: args.event.packageOnly || "",
      notes: args.event.notes || "",
      customFields: args.event.customFields || {},
      updates: args.event.updates || [],
      files: args.event.files || [],
      activity: args.event.activity || [],
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return toEventDto(await ctx.db.get(existing._id));
    }

    if (deletedMarker) {
      return null;
    }

    const eventId = await ctx.db.insert("events", {
      ...payload,
      createdByUserId: currentUser._id,
      createdAt: Date.now(),
    });

    return toEventDto(await ctx.db.get(eventId));
  },
});

export const remove = mutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const existing = await ctx.db
      .query("events")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventId))
      .unique();
    const deletedMarker = await ctx.db
      .query("deletedEventKeys")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventId))
      .unique();

    if (!existing) {
      return null;
    }

    await ctx.db.delete(existing._id);
    if (deletedMarker) {
      await ctx.db.patch(deletedMarker._id, {
        deletedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("deletedEventKeys", {
        eventKey: args.eventId,
        deletedAt: Date.now(),
      });
    }
    return args.eventId;
  },
});

export const backfillAccountsFromPayment = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await requireCurrentUser(ctx);
    if (currentUser.role !== "admin") {
      throw new Error("Only admins can backfill accounts.");
    }

    const events = await ctx.db.query("events").collect();
    let updated = 0;

    for (const event of events) {
      const nextAccounts = event.paymentStatus || "";
      if ((event.accounts || "") === nextAccounts) {
        continue;
      }

      await ctx.db.patch(event._id, {
        accounts: nextAccounts,
        updatedAt: Date.now(),
      });
      updated += 1;
    }

    return { updated };
  },
});

export const setDocumentNumberFromUpload = internalMutation({
  args: {
    eventKey: v.string(),
    documentType: v.union(v.literal("quote"), v.literal("invoice")),
    documentNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventKey))
      .unique();

    if (!existing) {
      return null;
    }

    const patch =
      args.documentType === "quote"
        ? { quoteNumber: args.documentNumber, updatedAt: Date.now() }
        : { invoiceNumber: args.documentNumber, updatedAt: Date.now() };

    await ctx.db.patch(existing._id, patch);
    return toEventDto(await ctx.db.get(existing._id));
  },
});

export const applyExtractedPdfData = internalMutation({
  args: {
    eventKey: v.string(),
    documentType: v.optional(v.union(v.literal("quote"), v.literal("invoice"))),
    documentNumber: v.optional(v.string()),
    exVatAuto: v.optional(v.union(v.number(), v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventKey))
      .unique();

    if (!existing) {
      return null;
    }

    const patch = {
      updatedAt: Date.now(),
    };

    if (args.documentType === "quote" && args.documentNumber) {
      patch.quoteNumber = args.documentNumber;
    }
    if (args.documentType === "invoice" && args.documentNumber) {
      patch.invoiceNumber = args.documentNumber;
    }
    if (args.exVatAuto !== undefined) {
      patch.exVatAuto = args.exVatAuto;
    }

    await ctx.db.patch(existing._id, patch);
    return await ctx.db.get(existing._id);
  },
});

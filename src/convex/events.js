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

const ACTIVITY_FIELD_LABELS = {
  name: "Client name",
  eventTitle: "Event name",
  date: "Date",
  hours: "Hours",
  branch: "Branch",
  products: "Products",
  status: "Status",
  location: "Location",
  paymentStatus: "Payment",
  accounts: "Accounts",
  quoteNumber: "Quote number",
  invoiceNumber: "Invoice number",
  exVatAuto: "ExVAT Auto",
  vinyl: "Vinyl",
  gsAi: "GS AI",
  imagesSent: "Images sent",
  snappic: "Snappic",
  attendants: "Attendants",
  exVat: "Ex VAT",
  packageOnly: "Package only",
  notes: "Notes",
};

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

function getChangedEventFields(previousRecord, nextRecord) {
  const changed = [];
  Object.entries(ACTIVITY_FIELD_LABELS).forEach(([fieldKey, label]) => {
    if (normalizeComparableValue(previousRecord?.[fieldKey]) !== normalizeComparableValue(nextRecord?.[fieldKey])) {
      changed.push(label);
    }
  });

  const previousCustom = previousRecord?.customFields || {};
  const nextCustom = nextRecord?.customFields || {};
  const allCustomKeys = new Set([...Object.keys(previousCustom), ...Object.keys(nextCustom)]);
  allCustomKeys.forEach((customKey) => {
    if (normalizeComparableValue(previousCustom[customKey]) !== normalizeComparableValue(nextCustom[customKey])) {
      changed.push(customKey);
    }
  });

  return changed;
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

function toEventListDto(record, creator = null) {
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
    createdByUserId: record.createdByUserId || null,
    createdByName: creator?.fullName || "",
    duplicatedFromEventKey: record.duplicatedFromEventKey || "",
    duplicatedFromEventName: record.duplicatedFromEventName || "",
  };
}

function createUniqueEventKey() {
  return `evt-${crypto.randomUUID()}`;
}

async function generateUniqueBookingToken(ctx) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    const existing = await ctx.db
      .query("eventBookings")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!existing) {
      return token;
    }
  }
  throw new Error("Unable to create a unique booking link right now.");
}

async function attachCreatorDetails(ctx, events, dtoMapper) {
  const creatorIdsByKey = new Map();
  events.forEach((record) => {
    if (record.createdByUserId) {
      creatorIdsByKey.set(String(record.createdByUserId), record.createdByUserId);
    }
  });
  const creatorEntries = await Promise.all(
    Array.from(creatorIdsByKey.entries()).map(async ([creatorKey, creatorId]) => [creatorKey, await ctx.db.get(creatorId)])
  );
  const userById = new Map(creatorEntries);
  return events.map((record) =>
    dtoMapper(record, userById.get(String(record.createdByUserId || "")) || null)
  );
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

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const events = await ctx.db.query("events").collect();
    const sortedEvents = events
      .slice()
      .sort((left, right) => String(left.eventKey).localeCompare(String(right.eventKey)));
    return attachCreatorDetails(ctx, sortedEvents, toEventListDto);
  },
});

export const listByWorkspaceYear = query({
  args: {
    workspaceYear: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return [];
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace_year", (q) => q.eq("workspaceYear", args.workspaceYear))
      .collect();
    const sortedEvents = events
      .slice()
      .sort((left, right) => String(left.eventKey).localeCompare(String(right.eventKey)));
    return attachCreatorDetails(ctx, sortedEvents, toEventListDto);
  },
});

export const hasAny = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCurrentUser(ctx);
    } catch {
      return false;
    }

    const existing = await ctx.db.query("events").take(1);
    return existing.length > 0;
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
      duplicatedFromEventKey: v.optional(v.string()),
      duplicatedFromEventName: v.optional(v.string()),
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
      duplicatedFromEventKey: args.event.duplicatedFromEventKey || "",
      duplicatedFromEventName: args.event.duplicatedFromEventName || "",
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
      const refreshed = await ctx.db.get(existing._id);
      const changedFields = getChangedEventFields(existing, refreshed);
      if (changedFields.length) {
        const actorName = currentUser.fullName || currentUser.firstName || currentUser.email;
        const eventName = refreshed.name || "Untitled event";
        const text = `Updated ${changedFields.join(", ")}.`;
        await ctx.db.insert("activityLog", {
          workspaceYear: refreshed.workspaceYear,
          eventId: existing._id,
          eventName,
          text,
          shortText: `${eventName}: ${text}`.slice(0, 120),
          actorName,
          actorUserId: currentUser._id,
          createdAt: Date.now(),
        });
      }
      return toEventDto(refreshed);
    }

    if (deletedMarker) {
      return null;
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

export const cloneEvent = mutation({
  args: {
    sourceEventKey: v.string(),
    includeDrawerInfo: v.boolean(),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const source = await ctx.db
      .query("events")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.sourceEventKey))
      .unique();
    if (!source) {
      throw new Error("Source event not found.");
    }

    const now = Date.now();
    const nextEventKey = createUniqueEventKey();
    const createdId = await ctx.db.insert("events", {
      eventKey: nextEventKey,
      workspaceYear: source.workspaceYear,
      name: source.name || "",
      eventTitle: source.eventTitle || "",
      duplicatedFromEventKey: source.eventKey,
      duplicatedFromEventName: source.eventTitle
        ? `${source.name || "Untitled event"} - ${source.eventTitle}`
        : (source.name || "Untitled event"),
      date: source.date || "",
      draftMonth: source.draftMonth || "",
      hours: source.hours || "",
      branch: source.branch || [],
      products: source.products || [],
      status: source.status || "",
      location: source.location || "",
      locationPlaceId: source.locationPlaceId || "",
      locationLat: typeof source.locationLat === "number" ? source.locationLat : undefined,
      locationLng: typeof source.locationLng === "number" ? source.locationLng : undefined,
      paymentStatus: source.paymentStatus || "",
      accounts: source.accounts || "",
      quoteNumber: source.quoteNumber || "",
      invoiceNumber: source.invoiceNumber || "",
      exVatAuto: source.exVatAuto ?? "",
      vinyl: source.vinyl || "",
      gsAi: source.gsAi || "",
      imagesSent: source.imagesSent || "",
      snappic: source.snappic || "",
      attendants: source.attendants || [],
      exVat: source.exVat ?? "",
      packageOnly: source.packageOnly || "",
      notes: source.notes || "",
      customFields: source.customFields || {},
      updates: [],
      files: [],
      activity: [],
      createdByUserId: currentUser._id,
      createdAt: now,
      updatedAt: now,
    });

    if (args.includeDrawerInfo) {
      const sourceUpdates = await ctx.db
        .query("eventUpdates")
        .withIndex("by_event", (q) => q.eq("eventId", source._id))
        .collect();
      for (const entry of sourceUpdates) {
        await ctx.db.insert("eventUpdates", {
          eventId: createdId,
          body: entry.body,
          actorName: entry.actorName,
          legacyEntryId: entry.legacyEntryId,
          createdByUserId: entry.createdByUserId,
          createdAt: entry.createdAt,
        });
      }

      const sourceFiles = await ctx.db
        .query("eventFiles")
        .withIndex("by_event", (q) => q.eq("eventId", source._id))
        .collect();
      for (const entry of sourceFiles) {
        await ctx.db.insert("eventFiles", {
          eventId: createdId,
          name: entry.name,
          storageId: entry.storageId,
          legacyFileId: entry.legacyFileId,
          contentType: entry.contentType,
          sizeLabel: entry.sizeLabel,
          createdByUserId: entry.createdByUserId,
          createdAt: entry.createdAt,
        });
      }

      const sourceActivity = await ctx.db
        .query("activityLog")
        .withIndex("by_event", (q) => q.eq("eventId", source._id))
        .collect();
      for (const entry of sourceActivity) {
        await ctx.db.insert("activityLog", {
          workspaceYear: source.workspaceYear,
          eventId: createdId,
          eventName: source.name || "Untitled event",
          text: entry.text,
          shortText: entry.shortText,
          actorName: entry.actorName,
          legacyEntryId: entry.legacyEntryId,
          actorUserId: entry.actorUserId,
          createdAt: entry.createdAt,
        });
      }

      const sourceBooking = await ctx.db
        .query("eventBookings")
        .withIndex("by_event", (q) => q.eq("eventId", source._id))
        .unique();
      if (sourceBooking) {
        const bookingId = await ctx.db.insert("eventBookings", {
          eventId: createdId,
          eventKey: nextEventKey,
          token: await generateUniqueBookingToken(ctx),
          formData: sourceBooking.formData,
          createdByUserId: sourceBooking.createdByUserId || currentUser._id,
          submittedByUserId: sourceBooking.submittedByUserId,
          publicAccessCount: 0,
          createdAt: now,
          updatedAt: now,
          submittedAt: sourceBooking.submittedAt,
          lastSubmittedIp: sourceBooking.lastSubmittedIp,
        });
        const sourceSnapshots = await ctx.db
          .query("bookingSnapshots")
          .withIndex("by_booking", (q) => q.eq("bookingId", sourceBooking._id))
          .collect();
        for (const snapshot of sourceSnapshots) {
          await ctx.db.insert("bookingSnapshots", {
            bookingId,
            eventId: createdId,
            storageId: snapshot.storageId,
            fileName: snapshot.fileName,
            sourceIp: snapshot.sourceIp,
            submittedAt: snapshot.submittedAt,
            createdByUserId: snapshot.createdByUserId,
            createdByLabel: snapshot.createdByLabel,
            createdAt: snapshot.createdAt,
          });
        }
      }
    }

    const activityText = args.includeDrawerInfo
      ? `Duplicated from ${source.name || "Untitled event"} with drawer data.`
      : `Duplicated from ${source.name || "Untitled event"} without drawer data.`;
    await ctx.db.insert("activityLog", {
      workspaceYear: source.workspaceYear,
      eventId: createdId,
      eventName: source.name || "Untitled event",
      text: activityText,
      shortText: activityText,
      actorName: currentUser.fullName || currentUser.firstName || currentUser.email,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    return toEventDto(await ctx.db.get(createdId), currentUser);
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

async function applyExtractedPdfDataPatch(ctx, args) {
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
}

export const applyExtractedPdfData = internalMutation({
  args: {
    eventKey: v.string(),
    documentType: v.optional(v.union(v.literal("quote"), v.literal("invoice"))),
    documentNumber: v.optional(v.string()),
    exVatAuto: v.optional(v.union(v.number(), v.string())),
  },
  handler: async (ctx, args) => applyExtractedPdfDataPatch(ctx, args),
});

export const applyExtractedPdfDataFromAction = mutation({
  args: {
    eventKey: v.string(),
    documentType: v.optional(v.union(v.literal("quote"), v.literal("invoice"))),
    documentNumber: v.optional(v.string()),
    exVatAuto: v.optional(v.union(v.number(), v.string())),
  },
  handler: async (ctx, args) => applyExtractedPdfDataPatch(ctx, args),
});

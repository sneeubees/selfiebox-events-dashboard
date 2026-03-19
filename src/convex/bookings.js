import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { createEmptyBookingForm } from "../bookingConstants";

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const exact = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T23:59:59`)
    : new Date(text);
  const timestamp = exact.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseIsoDateStart(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`)
    : new Date(text);
  const timestamp = exact.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  return String(value ?? "").trim();
}

function parseTimeValue(value) {
  const text = normalizeString(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatMinutesAsTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "";
  }
  const wrapped = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getSetupTimeFromStart(startTime) {
  const minutes = parseTimeValue(startTime);
  if (minutes == null) {
    return "";
  }
  return formatMinutesAsTime(minutes - 60);
}

function parseDurationHours(hoursValue) {
  const text = normalizeString(hoursValue).toLowerCase();
  if (!text) {
    return "";
  }

  const exactHours = text.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)/i);
  if (exactHours) {
    const hours = Math.round(Number(exactHours[1]));
    return Number.isFinite(hours) && hours >= 2 && hours <= 10 ? String(hours) : "";
  }

  const rangeMatch = text.match(/(\d{1,2})[:h]?(\d{2})?\s*[-–]\s*(\d{1,2})[:h]?(\d{2})?/i);
  if (rangeMatch) {
    const startHour = Number(rangeMatch[1]);
    const startMinute = Number(rangeMatch[2] || 0);
    const endHour = Number(rangeMatch[3]);
    const endMinute = Number(rangeMatch[4] || 0);
    if ([startHour, startMinute, endHour, endMinute].every((value) => Number.isFinite(value))) {
      let duration = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
      if (duration <= 0) {
        duration += 24 * 60;
      }
      const roundedHours = Math.ceil(duration / 60);
      return roundedHours >= 2 && roundedHours <= 10 ? String(roundedHours) : "";
    }
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 2 && numeric <= 10) {
    return String(Math.round(numeric));
  }

  return "";
}

function parseEventTimeRange(hoursValue) {
  const text = normalizeString(hoursValue);
  const match = text.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) {
    return { start: "", finish: "" };
  }
  return {
    start: `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`,
    finish: `${String(Number(match[3])).padStart(2, "0")}:${match[4]}`,
  };
}

async function getLabelDisplayMap(ctx, columnKey) {
  const rows = await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", columnKey))
    .collect();
  const map = new Map();
  rows.forEach((row) => {
    const name = normalizeString(row.name || row.abbreviation || row.optionKey);
    if (row.abbreviation) {
      map.set(normalizeString(row.abbreviation), name);
    }
    if (row.optionKey) {
      map.set(normalizeString(row.optionKey), name);
    }
    if (name) {
      map.set(name, name);
    }
  });
  return map;
}

function resolveDisplayValues(values, displayMap) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const normalized = normalizeString(value);
      return displayMap.get(normalized) || normalized;
    })
    .filter(Boolean);
}

async function buildInitialFormData(ctx, eventRecord) {
  const branchDisplayMap = await getLabelDisplayMap(ctx, "branch");
  const productDisplayMap = await getLabelDisplayMap(ctx, "products");
  const branchNames = resolveDisplayValues(eventRecord.branch, branchDisplayMap);
  const productNames = resolveDisplayValues(eventRecord.products, productDisplayMap);
  const timeRange = parseEventTimeRange(eventRecord.hours);
  return {
    ...createEmptyBookingForm(),
    product: productNames.join(", "),
    eventName: normalizeString(eventRecord.eventTitle),
    companyName: normalizeString(eventRecord.name),
    eventDate: normalizeString(eventRecord.date),
    region: branchNames.join(", "),
    address: normalizeString(eventRecord.location),
    addressPlaceId: normalizeString(eventRecord.locationPlaceId),
    addressLat: typeof eventRecord.locationLat === "number" ? eventRecord.locationLat : null,
    addressLng: typeof eventRecord.locationLng === "number" ? eventRecord.locationLng : null,
    setupTime: getSetupTimeFromStart(timeRange.start),
    eventStartTime: timeRange.start,
    eventFinishTime: timeRange.finish,
    durationHours: parseDurationHours(eventRecord.hours),
  };
}

function getBookingDateTimestamp(eventRecord, bookingRecord) {
  const timestamp = parseIsoDateStart(bookingRecord?.formData?.eventDate || eventRecord?.date);
  return timestamp;
}

function getPublicAccessPolicy(eventRecord, bookingRecord, now = Date.now()) {
  const eventTimestamp = getBookingDateTimestamp(eventRecord, bookingRecord);
  if (!eventTimestamp) {
    return {
      mode: "public",
      anonymousAllowed: true,
      remainingPublicClicks: null,
      cutoffTimestamp: null,
      isLocked: false,
    };
  }

  return {
    mode: "public",
    anonymousAllowed: true,
    remainingPublicClicks: null,
    cutoffTimestamp: null,
    isLocked: now >= eventTimestamp,
  };
}

function buildDrawerBookingDto(eventRecord, bookingRecord) {
  if (!bookingRecord) {
    return null;
  }

  const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
  return {
    id: String(bookingRecord._id),
    token: bookingRecord.token,
    formData: bookingRecord.formData,
    createdAt: bookingRecord.createdAt,
    updatedAt: bookingRecord.updatedAt,
    submittedAt: bookingRecord.submittedAt || null,
    publicAccessCount: bookingRecord.publicAccessCount || 0,
    publicMode: policy.mode,
    remainingPublicClicks: policy.remainingPublicClicks,
    cutoffTimestamp: policy.cutoffTimestamp,
    isLocked: policy.isLocked,
  };
}

async function getApprovedCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const clerkId = identity.subject ?? identity.tokenIdentifier;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();

  if (!user || !user.isApproved || !user.isActive) {
    return null;
  }

  return user;
}

async function requireCurrentUser(ctx) {
  const user = await getApprovedCurrentUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}

async function findEventByKey(ctx, eventKey) {
  return ctx.db
    .query("events")
    .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
    .unique();
}

async function findBookingByEventId(ctx, eventId) {
  return ctx.db
    .query("eventBookings")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
}

async function generateUniqueToken(ctx) {
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

function sanitizeFormData(formData) {
  const base = createEmptyBookingForm();
  const next = {
    ...base,
    ...(formData || {}),
    product: normalizeString(formData?.product),
    customerType: normalizeString(formData?.customerType),
    eventName: normalizeString(formData?.eventName || formData?.companyName),
    companyName: normalizeString(formData?.companyName),
    contactPerson: normalizeString(formData?.contactPerson),
    cell: normalizePhone(formData?.cell),
    email: normalizeString(formData?.email).toLowerCase(),
    eventDate: normalizeString(formData?.eventDate),
    region: normalizeString(formData?.region),
    address: normalizeString(formData?.address),
    addressPlaceId: normalizeString(formData?.addressPlaceId),
    addressLat: typeof formData?.addressLat === "number" ? formData.addressLat : null,
    addressLng: typeof formData?.addressLng === "number" ? formData.addressLng : null,
    pointOfContactName: normalizeString(formData?.pointOfContactName),
    pointOfContactNumber: normalizePhone(formData?.pointOfContactNumber),
    setupTime: normalizeString(formData?.setupTime),
    eventStartTime: normalizeString(formData?.eventStartTime),
    eventFinishTime: normalizeString(formData?.eventFinishTime),
    durationHours: normalizeString(formData?.durationHours),
    optionalExtras: Array.isArray(formData?.optionalExtras)
      ? Array.from(new Set(formData.optionalExtras.map((value) => normalizeString(value)).filter(Boolean)))
      : [],
    designYourself: normalizeString(formData?.designYourself),
    notes: normalizeString(formData?.notes),
    acceptedTerms: Boolean(formData?.acceptedTerms),
  };
  return next;
}

function validateFormData(formData) {
  if (!formData.product) return "Please select a product.";
  if (!formData.customerType) return "Please choose Corporate or Private.";
  if (!formData.eventName) return "Please enter the event name.";
  if (!formData.contactPerson) return "Please enter a contact person.";
  if (!formData.cell) return "Please enter a contact cell number.";
  if (!formData.email || !formData.email.includes("@")) return "Please enter a valid email address.";
  if (!formData.eventDate) return "Please enter the event date.";
  if (!formData.region) return "Please select a region.";
  if (!formData.address) return "Please enter the event address.";
  if (!formData.pointOfContactName) return "Please enter the point of contact for the day.";
  if (!formData.pointOfContactNumber) return "Please enter the point of contact number.";
  if (!formData.eventStartTime || !formData.eventFinishTime) return "Please enter the event start and finish time.";
  if (!formData.acceptedTerms) return "Please accept the terms and conditions before submitting.";
  return "";
}

async function buildPublicBookingDto(ctx, eventRecord, bookingRecord, access, viewerRole = "public") {
  const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
  const branchDisplayMap = await getLabelDisplayMap(ctx, "branch");
  const productDisplayMap = await getLabelDisplayMap(ctx, "products");
  const productNames = resolveDisplayValues(eventRecord.products, productDisplayMap);
  const branchNames = resolveDisplayValues(eventRecord.branch, branchDisplayMap);
  return {
    status: "ok",
    access,
    viewerRole,
    eventName: eventRecord.name || "SelfieBox booking",
    eventTitle: normalizeString(eventRecord.eventTitle),
    productNames,
    regionName: branchNames.join(", "),
    eventDate: eventRecord.date || bookingRecord.formData.eventDate || "",
    token: bookingRecord.token,
    formData: bookingRecord.formData,
    submittedAt: bookingRecord.submittedAt || null,
    publicMode: policy.mode,
    remainingPublicClicks: policy.remainingPublicClicks,
    isLocked: policy.isLocked,
  };
}

export const getForEvent = query({
  args: { eventKey: v.string() },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      return null;
    }

    const bookingRecord = await findBookingByEventId(ctx, eventRecord._id);
    return buildDrawerBookingDto(eventRecord, bookingRecord);
  },
});

export const generateForEvent = mutation({
  args: { eventKey: v.string() },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      throw new Error("Event not found.");
    }

    const existing = await findBookingByEventId(ctx, eventRecord._id);
    if (existing) {
      return buildDrawerBookingDto(eventRecord, existing);
    }

    const token = await generateUniqueToken(ctx);
    const now = Date.now();
    const bookingId = await ctx.db.insert("eventBookings", {
      eventId: eventRecord._id,
      eventKey: eventRecord.eventKey,
      token,
      formData: await buildInitialFormData(ctx, eventRecord),
      createdByUserId: currentUser._id,
      publicAccessCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return buildDrawerBookingDto(eventRecord, await ctx.db.get(bookingId));
  },
});

export const openPublicLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const bookingRecord = await ctx.db
      .query("eventBookings")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!bookingRecord) {
      return { status: "not_found" };
    }

    const eventRecord = await ctx.db.get(bookingRecord.eventId);
    if (!eventRecord) {
      return { status: "not_found" };
    }

    const approvedUser = await getApprovedCurrentUser(ctx);
    if (approvedUser) {
      return await buildPublicBookingDto(ctx, eventRecord, bookingRecord, "registered", approvedUser.role);
    }

    const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
    return await buildPublicBookingDto(ctx, eventRecord, bookingRecord, "public");
  },
});

export const submitPublicForm = mutation({
  args: {
    token: v.string(),
    baseUrl: v.optional(v.string()),
    formData: v.object({
      product: v.optional(v.string()),
      customerType: v.optional(v.string()),
      eventName: v.optional(v.string()),
      companyName: v.optional(v.string()),
      contactPerson: v.optional(v.string()),
      cell: v.optional(v.string()),
      email: v.optional(v.string()),
      eventDate: v.optional(v.string()),
      region: v.optional(v.string()),
      address: v.optional(v.string()),
      addressPlaceId: v.optional(v.string()),
      addressLat: v.optional(v.union(v.number(), v.null())),
      addressLng: v.optional(v.union(v.number(), v.null())),
      pointOfContactName: v.optional(v.string()),
      pointOfContactNumber: v.optional(v.string()),
      setupTime: v.optional(v.string()),
      eventStartTime: v.optional(v.string()),
      eventFinishTime: v.optional(v.string()),
      durationHours: v.optional(v.string()),
      optionalExtras: v.optional(v.array(v.string())),
      designYourself: v.optional(v.string()),
      notes: v.optional(v.string()),
      acceptedTerms: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const bookingRecord = await ctx.db
      .query("eventBookings")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!bookingRecord) {
      throw new Error("Booking link not found.");
    }

    const eventRecord = await ctx.db.get(bookingRecord.eventId);
    if (!eventRecord) {
      throw new Error("The related event could not be found.");
    }

    const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
    if (policy.isLocked) {
      throw new Error("This booking form is locked on the day of the event.");
    }
    const approvedUser = await getApprovedCurrentUser(ctx);

    const formData = sanitizeFormData(args.formData);
    const validationMessage = validateFormData(formData);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    const now = Date.now();
    await ctx.db.patch(bookingRecord._id, {
      formData,
      submittedAt: now,
      submittedByUserId: approvedUser?._id,
      updatedAt: now,
    });
    await ctx.db.patch(eventRecord._id, {
      eventTitle: formData.eventName,
      location: formData.address,
      locationPlaceId: formData.addressPlaceId || "",
      locationLat: typeof formData.addressLat === "number" ? formData.addressLat : undefined,
      locationLng: typeof formData.addressLng === "number" ? formData.addressLng : undefined,
      hours: `${formData.eventStartTime} - ${formData.eventFinishTime}`,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.bookingEmails.sendBookingSubmissionEmail, {
      bookingId: bookingRecord._id,
      baseUrl: normalizeString(args.baseUrl),
    });

    return await buildPublicBookingDto(
      ctx,
      eventRecord,
      await ctx.db.get(bookingRecord._id),
      approvedUser ? "registered" : "public",
      approvedUser?.role || "public"
    );
  },
});

export const getSubmissionEmailPayload = internalQuery({
  args: {
    bookingId: v.id("eventBookings"),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const bookingRecord = await ctx.db.get(args.bookingId);
    if (!bookingRecord) {
      return null;
    }

    const eventRecord = await ctx.db.get(bookingRecord.eventId);
    if (!eventRecord) {
      return null;
    }

    return {
      bookingId: String(bookingRecord._id),
      token: bookingRecord.token,
      eventName: eventRecord.name || "SelfieBox booking",
      linkUrl: `${normalizeString(args.baseUrl) || "https://events.selfiebox.co.za"}/${bookingRecord.token}`,
      formData: bookingRecord.formData,
      submittedAt: bookingRecord.submittedAt || null,
    };
  },
});

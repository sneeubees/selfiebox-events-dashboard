import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

function formatActivityTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function createActivityEntry(text, user, timestamp) {
  return {
    id: crypto.randomUUID(),
    text,
    user,
    date: formatActivityTimestamp(timestamp),
  };
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

async function getBranchEmailRecipients(ctx, branchValues) {
  const rows = await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", "branch"))
    .collect();
  const emailMap = new Map();
  rows.forEach((row) => {
    const email = normalizeString(row.email).toLowerCase();
    if (!email) {
      return;
    }
    const keys = [row.abbreviation, row.optionKey, row.name]
      .map((value) => normalizeString(value))
      .filter(Boolean);
    keys.forEach((key) => {
      emailMap.set(key, email);
    });
  });

  return Array.from(new Set(
    (Array.isArray(branchValues) ? branchValues : [])
      .map((value) => emailMap.get(normalizeString(value)))
      .filter(Boolean)
  ));
}

function normalizeCompareKey(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function findCustomColumnValueByLabel(ctx, eventRecord, targetLabel) {
  const customFields = eventRecord?.customFields || {};
  if (!customFields || typeof customFields !== "object") {
    return "";
  }

  const directKey = Object.keys(customFields).find((key) => normalizeCompareKey(key) === normalizeCompareKey(targetLabel));
  if (directKey) {
    return normalizeString(customFields[directKey]);
  }

  const customColumns = await ctx.db.query("customColumns").collect();
  const matchedColumn = customColumns.find(
    (column) =>
      column.isActive !== false &&
      (normalizeCompareKey(column.label) === normalizeCompareKey(targetLabel) ||
        normalizeCompareKey(column.columnKey) === normalizeCompareKey(targetLabel))
  );

  if (!matchedColumn) {
    return "";
  }

  return normalizeString(customFields[matchedColumn.columnKey]);
}

function normalizeDocumentToken(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function findDocumentFileForNumber(ctx, eventId, documentNumber) {
  const normalizedNumber = normalizeDocumentToken(documentNumber);
  if (!normalizedNumber) {
    return null;
  }
  const files = await ctx.db
    .query("eventFiles")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const match = files
    .filter((file) => normalizeDocumentToken(file.name).includes(normalizedNumber))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  if (!match?.storageId) {
    return null;
  }
  return {
    name: match.name,
    url: (await ctx.storage.getUrl(match.storageId)) || "",
  };
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
  const linkedFields = await buildLinkedFormFields(ctx, eventRecord);
  return {
    ...createEmptyBookingForm(),
    ...linkedFields,
  };
}

async function buildLinkedFormFields(ctx, eventRecord) {
  const branchDisplayMap = await getLabelDisplayMap(ctx, "branch");
  const productDisplayMap = await getLabelDisplayMap(ctx, "products");
  const branchNames = resolveDisplayValues(eventRecord.branch, branchDisplayMap);
  const productNames = resolveDisplayValues(eventRecord.products, productDisplayMap);
  const timeRange = parseEventTimeRange(eventRecord.hours);
  return {
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

async function buildMergedBookingFormData(ctx, eventRecord, formData) {
  const linkedFields = await buildLinkedFormFields(ctx, eventRecord);
  return {
    ...sanitizeFormData(formData),
    ...linkedFields,
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

async function buildDrawerBookingDto(ctx, eventRecord, bookingRecord) {
  if (!bookingRecord) {
    return null;
  }

  const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
  const snapshots = await getBookingSnapshots(ctx, bookingRecord._id);
  const formData = await buildMergedBookingFormData(ctx, eventRecord, bookingRecord.formData);
  return {
    id: String(bookingRecord._id),
    token: bookingRecord.token,
    formData,
    createdAt: bookingRecord.createdAt,
    updatedAt: bookingRecord.updatedAt,
    submittedAt: bookingRecord.submittedAt || null,
    publicAccessCount: bookingRecord.publicAccessCount || 0,
    publicMode: policy.mode,
    remainingPublicClicks: policy.remainingPublicClicks,
    cutoffTimestamp: policy.cutoffTimestamp,
    isLocked: policy.isLocked,
    snapshots,
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

async function getBookingSnapshots(ctx, bookingId) {
  const rows = await ctx.db
    .query("bookingSnapshots")
    .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
    .collect();
  const ordered = rows.sort((a, b) => b.submittedAt - a.submittedAt);
  return Promise.all(
    ordered.map(async (row) => ({
      id: String(row._id),
      fileName: row.fileName,
      sourceIp: row.sourceIp || "",
      submittedAt: row.submittedAt,
      createdByLabel: row.createdByLabel || "",
      url: (await ctx.storage.getUrl(row.storageId)) || "",
    }))
  );
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
  if (!formData.contactPerson) return "Please enter a contact person.";
  if (!formData.cell) return "Please enter a contact cell number.";
  if (!formData.email || !formData.email.includes("@")) return "Please enter a valid email address.";
  if (!formData.acceptedTerms) return "Please accept the terms and conditions before submitting.";
  return "";
}

async function buildPublicBookingDto(ctx, eventRecord, bookingRecord, access, viewerRole = "public") {
  const policy = getPublicAccessPolicy(eventRecord, bookingRecord);
  const branchDisplayMap = await getLabelDisplayMap(ctx, "branch");
  const productDisplayMap = await getLabelDisplayMap(ctx, "products");
  const productNames = resolveDisplayValues(eventRecord.products, productDisplayMap);
  const branchNames = resolveDisplayValues(eventRecord.branch, branchDisplayMap);
  const quoteFile = await findDocumentFileForNumber(ctx, eventRecord._id, eventRecord.quoteNumber);
  const invoiceFile = await findDocumentFileForNumber(ctx, eventRecord._id, eventRecord.invoiceNumber);
  const designStatus = await findCustomColumnValueByLabel(ctx, eventRecord, "Designs");
  const attendantName = Array.isArray(eventRecord.attendants) && eventRecord.attendants.length
    ? normalizeString(eventRecord.attendants[0])
    : "";
  const formData = await buildMergedBookingFormData(ctx, eventRecord, bookingRecord.formData);
  return {
    status: "ok",
    access,
    viewerRole,
    eventName: eventRecord.name || "SelfieBox booking",
    eventTitle: normalizeString(eventRecord.eventTitle),
    productNames,
    regionName: branchNames.join(", "),
    eventDate: eventRecord.date || bookingRecord.formData.eventDate || "",
    venueAddress: eventRecord.location || bookingRecord.formData.address || "",
    quoteNumber: normalizeString(eventRecord.quoteNumber),
    quoteUrl: quoteFile?.url || "",
    invoiceNumber: normalizeString(eventRecord.invoiceNumber),
    invoiceUrl: invoiceFile?.url || "",
    designStatus,
    attendantName,
    token: bookingRecord.token,
    formData,
    submittedAt: bookingRecord.submittedAt || null,
    publicMode: policy.mode,
    remainingPublicClicks: policy.remainingPublicClicks,
    isLocked: policy.isLocked,
  };
}

async function buildSubmissionPayload(ctx, bookingRecord, eventRecord, baseUrl) {
  const rawBaseUrl = normalizeString(baseUrl) || process.env.APP_BASE_URL || "";
  const trimmedBaseUrl = rawBaseUrl.replace(/\/+$/, "");
  const submittedBy = bookingRecord.submittedByUserId
    ? await ctx.db.get(bookingRecord.submittedByUserId)
    : null;
  const branchDisplayMap = await getLabelDisplayMap(ctx, "branch");
  const productDisplayMap = await getLabelDisplayMap(ctx, "products");
  const productNames = resolveDisplayValues(eventRecord.products, productDisplayMap);
  const branchNames = resolveDisplayValues(eventRecord.branch, branchDisplayMap);
  const branchEmails = await getBranchEmailRecipients(ctx, eventRecord.branch);
  const designStatus = await findCustomColumnValueByLabel(ctx, eventRecord, "Designs");
  const attendantName = Array.isArray(eventRecord.attendants) && eventRecord.attendants.length
    ? normalizeString(eventRecord.attendants[0])
    : "";
  const formData = await buildMergedBookingFormData(ctx, eventRecord, bookingRecord.formData);
  return {
    bookingId: bookingRecord._id,
    eventId: bookingRecord.eventId,
    eventName: eventRecord.name || "SelfieBox booking",
    eventTitle: normalizeString(eventRecord.eventTitle),
    formData,
    productNames,
    regionName: branchNames.join(", "),
    quoteNumber: normalizeString(eventRecord.quoteNumber),
    invoiceNumber: normalizeString(eventRecord.invoiceNumber),
    designStatus,
    attendantName,
    submittedAt: bookingRecord.submittedAt || bookingRecord.updatedAt || bookingRecord.createdAt,
    sourceIp: bookingRecord.lastSubmittedIp || "",
    submittedByUserId: bookingRecord.submittedByUserId || null,
    submittedByLabel: submittedBy?.fullName || submittedBy?.email || "",
    branchEmails,
    linkUrl: trimmedBaseUrl ? `${trimmedBaseUrl}/${bookingRecord.token}` : bookingRecord.token,
  };
}

export const getForEvent = query({
  args: { eventKey: v.string(), refreshKey: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      return null;
    }

    const bookingRecord = await findBookingByEventId(ctx, eventRecord._id);
    return await buildDrawerBookingDto(ctx, eventRecord, bookingRecord);
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
    const eventDateTimestamp = parseIsoDateStart(eventRecord.date);
    if (eventDateTimestamp != null && eventDateTimestamp < Date.now()) {
      throw new Error("Booking links cannot be generated for past events.");
    }

    const existing = await findBookingByEventId(ctx, eventRecord._id);
    if (existing) {
      return await buildDrawerBookingDto(ctx, eventRecord, existing);
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

    await ctx.db.patch(eventRecord._id, {
      activity: [
        ...(eventRecord.activity || []),
        createActivityEntry("generated a booking link.", currentUser.fullName || currentUser.email || "Unknown user", now),
      ],
      updatedAt: now,
    });

    return await buildDrawerBookingDto(ctx, await ctx.db.get(eventRecord._id), await ctx.db.get(bookingId));
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
    clientIp: v.optional(v.string()),
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
    const normalizedIp = normalizeString(args.clientIp);

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
      lastSubmittedIp: normalizedIp || undefined,
      updatedAt: now,
    });
    await ctx.db.patch(eventRecord._id, {
      eventTitle: formData.eventName,
      location: formData.address,
      locationPlaceId: formData.addressPlaceId || "",
      locationLat: typeof formData.addressLat === "number" ? formData.addressLat : undefined,
      locationLng: typeof formData.addressLng === "number" ? formData.addressLng : undefined,
      hours:
        formData.eventStartTime && formData.eventFinishTime
          ? `${formData.eventStartTime} - ${formData.eventFinishTime}`
          : "",
      activity: [
        ...(eventRecord.activity || []),
        createActivityEntry(
          `received a booking form submission${normalizedIp ? ` from ${normalizedIp}` : ""}.`,
          approvedUser?.fullName || formData.contactPerson || "Booking form",
          now
        ),
      ],
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.bookingEmails.sendBookingSubmissionEmail, {
      bookingId: bookingRecord._id,
      baseUrl: normalizeString(args.baseUrl),
    });

    const refreshedBookingRecord = await ctx.db.get(bookingRecord._id);
    return await buildPublicBookingDto(
      ctx,
      await ctx.db.get(eventRecord._id),
      refreshedBookingRecord,
      approvedUser ? "registered" : "public",
      approvedUser?.role || "public"
    );
  },
});

export const regenerateSnapshotForEvent = mutation({
  args: {
    eventKey: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const eventRecord = await findEventByKey(ctx, args.eventKey);
    if (!eventRecord) {
      throw new Error("Event not found.");
    }
    const bookingRecord = await findBookingByEventId(ctx, eventRecord._id);
    if (!bookingRecord) {
      throw new Error("Generate a booking link first.");
    }

    await ctx.scheduler.runAfter(0, internal.bookingEmails.generateBookingSnapshot, {
      bookingId: bookingRecord._id,
      baseUrl: normalizeString(args.baseUrl),
      snapshotLabel: "Final Generated",
    });

    const now = Date.now();
    await ctx.db.insert("activityLog", {
      workspaceYear: eventRecord.workspaceYear,
      eventId: eventRecord._id,
      eventName: eventRecord.name || "Untitled event",
      text: "Generated a fresh booking PDF snapshot.",
      shortText: `${eventRecord.name || "Untitled event"}: Generated a fresh booking PDF snapshot.`,
      actorName: currentUser.fullName || currentUser.firstName || currentUser.email,
      actorUserId: currentUser._id,
      createdAt: now,
    });

    return { ok: true };
  },
});

export const regenerateSnapshotForEventNow = action({
  args: {
    eventKey: v.string(),
    baseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await ctx.runQuery(internal.bookings.getApprovedCurrentUserInternal, {});
    if (!currentUser) {
      throw new Error("Not authenticated");
    }
    const eventRecord = await ctx.runQuery(internal.bookings.findEventByKeyInternal, {
      eventKey: args.eventKey,
    });
    if (!eventRecord) {
      throw new Error("Event not found.");
    }

    const bookingRecord = await ctx.runQuery(internal.bookings.findBookingByEventIdInternal, {
      eventId: eventRecord._id,
    });
    if (!bookingRecord) {
      throw new Error("Generate a booking link first.");
    }

    const snapshotResult = await ctx.runAction(internal.bookingEmails.generateBookingSnapshot, {
      bookingId: bookingRecord._id,
      baseUrl: normalizeString(args.baseUrl),
      snapshotLabel: "Final Generated",
    });
    if (!snapshotResult?.saved) {
      throw new Error("The booking PDF could not be regenerated right now.");
    }

    try {
      await ctx.runMutation(internal.bookings.logBookingSnapshotActivity, {
        eventId: eventRecord._id,
        actorName: currentUser.fullName || currentUser.firstName || currentUser.email,
        actorUserId: currentUser._id,
      });
    } catch (error) {
      console.error("Failed to log booking snapshot activity", error);
    }

      return {
        ok: true,
        fileName: snapshotResult.fileName || "",
        snapshot: snapshotResult.snapshot || null,
      };
    },
  });

export const findEventByKeyInternal = internalQuery({
  args: {
    eventKey: v.string(),
  },
  handler: async (ctx, args) => findEventByKey(ctx, args.eventKey),
});

export const findBookingByEventIdInternal = internalQuery({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => findBookingByEventId(ctx, args.eventId),
});

export const getApprovedCurrentUserInternal = internalQuery({
  args: {},
  handler: async (ctx) => getApprovedCurrentUser(ctx),
});

export const logBookingSnapshotActivity = internalMutation({
  args: {
    eventId: v.id("events"),
    actorName: v.string(),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const eventRecord = await ctx.db.get(args.eventId);
    if (!eventRecord) {
      return { ok: false };
    }
    const now = Date.now();
    await ctx.db.insert("activityLog", {
      workspaceYear: eventRecord.workspaceYear,
      eventId: eventRecord._id,
      eventName: eventRecord.name || "Untitled event",
      text: "Generated a fresh booking PDF snapshot.",
      shortText: `${eventRecord.name || "Untitled event"}: Generated a fresh booking PDF snapshot.`,
      actorName: args.actorName,
      actorUserId: args.actorUserId,
      createdAt: now,
    });
    return { ok: true };
  },
});

export const saveBookingSnapshot = internalMutation({
  args: {
    bookingId: v.id("eventBookings"),
    eventId: v.id("events"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    sourceIp: v.optional(v.string()),
    submittedAt: v.number(),
    createdByUserId: v.optional(v.id("users")),
    createdByLabel: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      const snapshotId = await ctx.db.insert("bookingSnapshots", {
        bookingId: args.bookingId,
        eventId: args.eventId,
        storageId: args.storageId,
        fileName: args.fileName,
      sourceIp: args.sourceIp,
      submittedAt: args.submittedAt,
        createdByUserId: args.createdByUserId,
        createdByLabel: args.createdByLabel,
        createdAt: Date.now(),
      });
      return {
        ok: true,
        id: String(snapshotId),
        fileName: args.fileName,
        sourceIp: args.sourceIp || "",
        submittedAt: args.submittedAt,
        createdByLabel: args.createdByLabel || "",
      };
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

    return await buildSubmissionPayload(ctx, bookingRecord, eventRecord, args.baseUrl);
  },
});

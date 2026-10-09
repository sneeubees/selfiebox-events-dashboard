import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Linked bookings ("more days or regions of the same event").
//
// A booking group is a set of event rows sharing `bookingGroupId`; exactly one
// row is the primary (`bookingGroupPrimary: true`). Files and drawer updates are
// stored against the PRIMARY row and shown on every row. When a SHARED field
// is changed on any row, the change is copied to the siblings in the same
// transaction (events.js:upsert -> fanOutSharedFields). Per-row fields stay
// independent: event name, date, branch, location, hours, time, products,
// quantities, attendants, Excl JC, status (status asks "apply to all?").
// ---------------------------------------------------------------------------

export const SHARED_FIELDS = [
  "name", "paymentStatus", "accounts", "quoteNumber", "invoiceNumber", "exVatAuto",
  "vinyl", "gsAi", "imagesSent", "snappic", "packageOnly", "notes", "digitalOnly", "exVat",
];

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function newGroupId() {
  return `grp-${crypto.randomUUID()}`;
}

// Excl JC lives in customFields; resolve its key(s) by column label plus the
// legacy import keys (same rule as events.cloneEvent).
export async function resolveExclJcKeys(ctx) {
  const keys = new Set(["custom_excl_jc", "exclJc"]);
  const columns = await ctx.db.query("customColumns").collect();
  for (const column of columns) {
    const label = String(column.label || "").toLowerCase();
    if (label.includes("excl") && label.includes("jc")) keys.add(column.columnKey);
  }
  return keys;
}

export async function getGroupMembers(ctx, groupId) {
  if (!groupId) return [];
  const members = await ctx.db
    .query("events")
    .withIndex("by_booking_group", (q) => q.eq("bookingGroupId", groupId))
    .collect();
  return members.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.createdAt - b.createdAt);
}

// The row that holds the group's files and updates (the primary), or the row
// itself when it is not in a group.
export async function resolveStorageEvent(ctx, eventRecord) {
  if (!eventRecord || !eventRecord.bookingGroupId) return eventRecord;
  if (eventRecord.bookingGroupPrimary) return eventRecord;
  const members = await getGroupMembers(ctx, eventRecord.bookingGroupId);
  return members.find((m) => m.bookingGroupPrimary) || members[0] || eventRecord;
}

function comparable(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Copy the shared fields that changed between `before` and `after` (the row the
// user edited) to every other row in its group. One transaction, N patches.
export async function fanOutSharedFields(ctx, before, after, currentUser, options = {}) {
  if (!after || !after.bookingGroupId) return 0;
  const exclJcKeys = await resolveExclJcKeys(ctx);
  const patch = {};
  for (const key of SHARED_FIELDS) {
    if (comparable(before?.[key]) !== comparable(after[key])) patch[key] = after[key];
  }
  const customBefore = before?.customFields || {};
  const customAfter = after.customFields || {};
  const customChanges = {};
  for (const key of new Set([...Object.keys(customBefore), ...Object.keys(customAfter)])) {
    if (exclJcKeys.has(key)) continue;
    if (comparable(customBefore[key]) !== comparable(customAfter[key]) && customAfter[key] !== undefined) customChanges[key] = customAfter[key];
  }
  const statusChanged = options.applyStatusToGroup && comparable(before?.status) !== comparable(after.status) && after.status;
  const changedLabels = [...Object.keys(patch), ...Object.keys(customChanges), ...(statusChanged ? ["status"] : [])];
  if (!changedLabels.length) return 0;

  const members = await getGroupMembers(ctx, after.bookingGroupId);
  const now = Date.now();
  const actorName = currentUser ? (currentUser.fullName || currentUser.firstName || currentUser.email) : "System";
  let count = 0;
  for (const sibling of members) {
    if (String(sibling._id) === String(after._id)) continue;
    const siblingPatch = { ...patch, updatedAt: now };
    if (Object.keys(customChanges).length) siblingPatch.customFields = { ...(sibling.customFields || {}), ...customChanges };
    if (statusChanged && comparable(sibling.status) !== comparable(after.status)) {
      siblingPatch.status = after.status;
      siblingPatch.statusTimeline = [...(sibling.statusTimeline || []), { status: after.status, at: now }];
      if (sibling.status === "Web Request" && after.status !== "Web Request" && !sibling.firstStatusChangeByUserId && currentUser) {
        siblingPatch.firstStatusChangeByUserId = currentUser._id;
      }
    }
    await ctx.db.patch(sibling._id, siblingPatch);
    await ctx.db.insert("activityLog", {
      workspaceYear: sibling.workspaceYear,
      eventId: sibling._id,
      eventName: sibling.name || "Untitled event",
      text: `Updated ${changedLabels.join(", ")} (linked booking, changed on ${after.date || "another day"}).`,
      shortText: `${sibling.name || "Untitled event"}: linked update (${changedLabels.join(", ")})`.slice(0, 120),
      actorName,
      actorUserId: currentUser ? currentUser._id : undefined,
      createdAt: now,
    });
    count += 1;
  }
  return count;
}

// Move the group's files and drawer updates from one row to another (when the
// primary is unlinked or deleted).
export async function moveGroupStorage(ctx, fromEventId, toEventId) {
  if (!fromEventId || !toEventId || String(fromEventId) === String(toEventId)) return;
  const files = await ctx.db.query("eventFiles").withIndex("by_event", (q) => q.eq("eventId", fromEventId)).collect();
  for (const file of files) await ctx.db.patch(file._id, { eventId: toEventId });
  const updates = await ctx.db.query("eventUpdates").withIndex("by_event", (q) => q.eq("eventId", fromEventId)).collect();
  for (const update of updates) await ctx.db.patch(update._id, { eventId: toEventId });
}

// Called when a row leaves a group (unlink or delete): hands the primary role
// (and the files/updates) to the next row, or dissolves a group of one.
export async function handOverPrimary(ctx, leavingRecord) {
  if (!leavingRecord?.bookingGroupId) return;
  const others = (await getGroupMembers(ctx, leavingRecord.bookingGroupId)).filter((m) => String(m._id) !== String(leavingRecord._id));
  if (!others.length) return;
  if (leavingRecord.bookingGroupPrimary) {
    const next = others[0];
    await ctx.db.patch(next._id, { bookingGroupPrimary: true });
    await moveGroupStorage(ctx, leavingRecord._id, next._id);
  }
  if (others.length === 1) {
    // A group of one is just an event.
    await ctx.db.patch(others[0]._id, { bookingGroupId: undefined, bookingGroupPrimary: undefined });
  }
}

async function requireCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  let user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
  if (!user) {
    const email = String(identity.email || "").trim().toLowerCase();
    if (email) user = (await ctx.db.query("users").collect()).find((c) => c.email === email) || null;
  }
  if (!user) throw new Error("User record not found.");
  if (!user.isApproved || !user.isActive) throw new Error("User access is pending approval.");
  return user;
}

async function findEventByKey(ctx, eventKey) {
  return ctx.db.query("events").withIndex("by_event_key", (q) => q.eq("eventKey", eventKey)).unique();
}

function createUniqueEventKey() {
  return `evt-${crypto.randomUUID()}`;
}

async function generateUniqueBookingToken(ctx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const existing = await ctx.db.query("eventBookings").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!existing) return token;
  }
  throw new Error("Unable to create a unique booking link right now.");
}

function memberDto(record) {
  return {
    eventKey: record.eventKey,
    name: record.name || "",
    eventTitle: record.eventTitle || "",
    date: record.date || "",
    branch: record.branch || [],
    location: record.location || "",
    status: record.status || "",
    workspaceYear: record.workspaceYear,
    isPrimary: Boolean(record.bookingGroupPrimary),
  };
}

// Group membership for the badge / drawer header.
export const getGroupInfo = query({
  args: { eventKey: v.string() },
  handler: async (ctx, args) => {
    try { await requireCurrentUser(ctx); } catch { return null; }
    const record = await findEventByKey(ctx, args.eventKey);
    if (!record || !record.bookingGroupId) return null;
    const members = await getGroupMembers(ctx, record.bookingGroupId);
    return { groupId: record.bookingGroupId, members: members.map(memberDto) };
  },
});

const rowValidator = v.object({
  date: v.string(),
  eventTitle: v.optional(v.string()),
  branch: v.array(v.string()),
  location: v.optional(v.string()),
  locationPlaceId: v.optional(v.string()),
  locationLat: v.optional(v.union(v.number(), v.null())),
  locationLng: v.optional(v.union(v.number(), v.null())),
  hours: v.optional(v.string()),
  time: v.optional(v.string()),
  products: v.optional(v.array(v.string())),
  productQuantities: v.optional(v.record(v.string(), v.number())),
  attendants: v.optional(v.array(v.string())),
});

// "Duplicate -> B: more days or regions": creates the extra rows as a linked
// booking with the source. Shared fields are copied from the source; the
// per-row fields come from each row; Excl JC starts at 0.
export const createLinkedRows = mutation({
  args: { sourceEventKey: v.string(), rows: v.array(rowValidator) },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const source = await findEventByKey(ctx, args.sourceEventKey);
    if (!source) throw new Error("Source event not found.");
    if (!args.rows.length) throw new Error("Add at least one day or region.");

    const now = Date.now();
    const exclJcKeys = await resolveExclJcKeys(ctx);
    let groupId = source.bookingGroupId;
    if (!groupId) {
      groupId = newGroupId();
      await ctx.db.patch(source._id, { bookingGroupId: groupId, bookingGroupPrimary: true, updatedAt: now });
    }
    const sourceBooking = await ctx.db.query("eventBookings").withIndex("by_event", (q) => q.eq("eventId", source._id)).unique();
    const customFields = { ...(source.customFields || {}) };
    for (const key of exclJcKeys) if (key in customFields) customFields[key] = "0";

    const created = [];
    for (const row of args.rows) {
      const date = String(row.date || "").trim();
      const parsed = new Date(`${date}T12:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())) throw new Error(`Invalid date: ${row.date}`);
      const eventKey = createUniqueEventKey();
      const eventId = await ctx.db.insert("events", {
        eventKey,
        workspaceYear: parsed.getFullYear(),
        name: source.name || "",
        eventTitle: row.eventTitle ?? source.eventTitle ?? "",
        duplicatedFromEventKey: source.eventKey,
        duplicatedFromEventName: source.eventTitle ? `${source.name || "Untitled event"} - ${source.eventTitle}` : (source.name || "Untitled event"),
        date,
        draftMonth: MONTH_NAMES[parsed.getMonth()],
        hours: row.hours ?? source.hours ?? "",
        time: row.time ?? source.time ?? "",
        branch: row.branch && row.branch.length ? row.branch : (source.branch || []),
        products: row.products ?? source.products ?? [],
        productQuantities: row.productQuantities ?? source.productQuantities ?? {},
        status: source.status || "",
        digitalOnly: Boolean(source.digitalOnly),
        location: row.location ?? source.location ?? "",
        locationPlaceId: row.locationPlaceId ?? (row.location === undefined ? source.locationPlaceId || "" : ""),
        locationLat: typeof row.locationLat === "number" ? row.locationLat : (row.location === undefined && typeof source.locationLat === "number" ? source.locationLat : undefined),
        locationLng: typeof row.locationLng === "number" ? row.locationLng : (row.location === undefined && typeof source.locationLng === "number" ? source.locationLng : undefined),
        paymentStatus: source.paymentStatus || "",
        accounts: source.accounts || "",
        quoteNumber: source.quoteNumber || "",
        invoiceNumber: source.invoiceNumber || "",
        exVatAuto: source.exVatAuto ?? "",
        vinyl: source.vinyl || "",
        gsAi: source.gsAi || "",
        imagesSent: source.imagesSent || "",
        snappic: source.snappic || "",
        attendants: row.attendants ?? [],
        exVat: source.exVat ?? "",
        packageOnly: source.packageOnly || "",
        notes: source.notes || "",
        customFields,
        updates: [],
        files: [],
        activity: [],
        bookingGroupId: groupId,
        bookingGroupPrimary: false,
        createdByUserId: currentUser._id,
        createdAt: now,
        updatedAt: now,
      });
      if (sourceBooking) {
        await ctx.db.insert("eventBookings", {
          eventId,
          eventKey,
          token: await generateUniqueBookingToken(ctx),
          formData: { ...sourceBooking.formData, eventDate: date, address: row.location ?? sourceBooking.formData.address ?? "", eventStartTime: "", eventFinishTime: "" },
          createdByUserId: currentUser._id,
          publicAccessCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert("activityLog", {
        workspaceYear: parsed.getFullYear(),
        eventId,
        eventName: source.name || "Untitled event",
        text: `Added to the linked booking of ${source.name || "Untitled event"} (${date}${row.branch && row.branch.length ? ", " + row.branch.join("/") : ""}).`,
        shortText: `${source.name || "Untitled event"}: linked row added (${date})`.slice(0, 120),
        actorName: currentUser.fullName || currentUser.firstName || currentUser.email,
        actorUserId: currentUser._id,
        createdAt: now,
      });
      created.push(eventKey);
    }
    return { groupId, createdEventKeys: created };
  },
});

// Link existing rows into one booking (for bookings created the old way).
export const linkEvents = mutation({
  args: { eventKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const records = [];
    for (const key of args.eventKeys) {
      const record = await findEventByKey(ctx, key);
      if (record) records.push(record);
    }
    if (records.length < 2) throw new Error("Select at least two events to link.");
    const existingGroups = new Set(records.map((r) => r.bookingGroupId).filter(Boolean));
    if (existingGroups.size > 1) throw new Error("These events belong to different linked bookings. Unlink first.");
    const groupId = existingGroups.size ? [...existingGroups][0] : newGroupId();
    const sorted = records.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.createdAt - b.createdAt);
    const currentPrimary = records.find((r) => r.bookingGroupId === groupId && r.bookingGroupPrimary);
    const primary = currentPrimary || sorted[0];
    const now = Date.now();
    for (const record of records) {
      const isPrimary = String(record._id) === String(primary._id);
      if (record.bookingGroupId !== groupId || Boolean(record.bookingGroupPrimary) !== isPrimary) {
        await ctx.db.patch(record._id, { bookingGroupId: groupId, bookingGroupPrimary: isPrimary, updatedAt: now });
      }
      if (!isPrimary) await moveGroupStorage(ctx, record._id, primary._id);
      await ctx.db.insert("activityLog", {
        workspaceYear: record.workspaceYear, eventId: record._id, eventName: record.name || "Untitled event",
        text: `Linked into one booking (${records.length} rows).`, shortText: `${record.name || "Untitled event"}: linked booking`.slice(0, 120),
        actorName: currentUser.fullName || currentUser.firstName || currentUser.email, actorUserId: currentUser._id, createdAt: now,
      });
    }
    return { groupId, primaryEventKey: primary.eventKey };
  },
});

// Take one row out of its linked booking (e.g. to cancel just that day).
export const unlinkFromGroup = mutation({
  args: { eventKey: v.string() },
  handler: async (ctx, args) => {
    const currentUser = await requireCurrentUser(ctx);
    const record = await findEventByKey(ctx, args.eventKey);
    if (!record || !record.bookingGroupId) return null;
    await handOverPrimary(ctx, record);
    await ctx.db.patch(record._id, { bookingGroupId: undefined, bookingGroupPrimary: undefined, updatedAt: Date.now() });
    await ctx.db.insert("activityLog", {
      workspaceYear: record.workspaceYear, eventId: record._id, eventName: record.name || "Untitled event",
      text: "Unlinked from the linked booking - this row is now on its own.", shortText: `${record.name || "Untitled event"}: unlinked`.slice(0, 120),
      actorName: currentUser.fullName || currentUser.firstName || currentUser.email, actorUserId: currentUser._id, createdAt: Date.now(),
    });
    return { eventKey: record.eventKey };
  },
});

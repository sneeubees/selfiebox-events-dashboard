import { mutation } from "./_generated/server";
import { v } from "convex/values";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PALETTE = ["#d7e5f5", "#ffe1b8", "#c8ddf7", "#dfe7f6", "#f7d3e3", "#cfead6", "#f9d9b8", "#e1dcfa"];

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function abbreviateLabel(value) {
  return normalizeText(value)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 5)
    .toUpperCase();
}

function uniqueList(values) {
  return Array.from(new Set((values || []).map((value) => normalizeText(value)).filter(Boolean)));
}

function monthNameFromNumber(monthNumber) {
  return MONTH_NAMES[Math.max(0, Math.min(11, Number(monthNumber) - 1))] || "January";
}

function shortActivity(eventName, text) {
  const summary = `${eventName}: ${text}`;
  return summary.length > 64 ? `${summary.slice(0, 61)}...` : summary;
}

async function ensureWorkspace(ctx, workspaceYear, createdByUserId) {
  const existing = await ctx.db
    .query("workspaces")
    .withIndex("by_year", (q) => q.eq("year", workspaceYear))
    .unique();

  if (existing) {
    return existing;
  }

  const workspaceId = await ctx.db.insert("workspaces", {
    year: workspaceYear,
    name: String(workspaceYear),
    createdByUserId: createdByUserId || undefined,
    createdAt: Date.now(),
  });

  return ctx.db.get(workspaceId);
}

async function ensureLabelOption(ctx, columnKey, rawName, orderHint) {
  const name = normalizeText(rawName);
  if (!name) {
    return "";
  }

  const existing = (await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", columnKey))
    .collect())
    .find((option) => {
      if (["branch", "products"].includes(columnKey)) {
        return normalizeKey(option.name) === normalizeKey(name) || normalizeKey(option.abbreviation || option.optionKey) === normalizeKey(name);
      }
      return normalizeKey(option.name) === normalizeKey(name);
    });

  if (existing) {
    return ["branch", "products"].includes(columnKey)
      ? normalizeText(existing.abbreviation || existing.optionKey || existing.name)
      : normalizeText(existing.name);
  }

  const siblings = await ctx.db
    .query("labelOptions")
    .withIndex("by_column", (q) => q.eq("columnKey", columnKey))
    .collect();
  const order = siblings.length ? Math.max(...siblings.map((option) => option.order || 0)) + 1 : (orderHint ?? 0);
  const color = columnKey === "status" || columnKey === "paymentStatus"
    ? "#d6d6d6"
    : columnKey === "vinyl" || columnKey === "gsAi" || columnKey === "imagesSent" || columnKey === "snappic"
      ? (normalizeKey(name) === "yes" ? "#2fc26d" : "#d93c56")
      : PALETTE[order % PALETTE.length];
  const abbreviation = columnKey === "branch" || columnKey === "products" ? abbreviateLabel(name) : "";

  await ctx.db.insert("labelOptions", {
    columnKey,
    optionKey: name,
    name,
    abbreviation,
    color,
    order,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return columnKey === "branch" || columnKey === "products" ? abbreviation : name;
}

function makeLegacyUpdateKey(itemId, createdAt, actorName, body) {
  return `${itemId}|${createdAt}|${normalizeText(actorName)}|${normalizeText(body).slice(0, 80)}`;
}

export const importMonthWorkbook = mutation({
  args: {
    workspaceYear: v.number(),
    monthNumber: v.number(),
    events: v.array(v.object({
      itemId: v.string(),
      name: v.string(),
      date: v.optional(v.string()),
      hours: v.optional(v.string()),
      branch: v.array(v.string()),
      products: v.array(v.string()),
      status: v.optional(v.string()),
      location: v.optional(v.string()),
      paymentStatus: v.optional(v.string()),
      vinyl: v.optional(v.string()),
      gsAi: v.optional(v.string()),
      imagesSent: v.optional(v.string()),
      snappic: v.optional(v.string()),
      attendants: v.array(v.string()),
      exVat: v.optional(v.union(v.number(), v.string())),
      packageOnly: v.optional(v.string()),
    })),
    updates: v.array(v.object({
      itemId: v.string(),
      actorName: v.string(),
      body: v.string(),
      createdAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const importingUser = null;
    await ensureWorkspace(ctx, args.workspaceYear, importingUser?._id);

    const monthName = monthNameFromNumber(args.monthNumber);
    const updatesByItemId = new Map();
    for (const update of args.updates) {
      const key = normalizeText(update.itemId);
      if (!key || !normalizeText(update.body)) {
        continue;
      }
      const list = updatesByItemId.get(key) || [];
      list.push(update);
      updatesByItemId.set(key, list);
    }

    let createdEvents = 0;
    let updatedEvents = 0;
    let insertedUpdates = 0;

    for (const sourceEvent of args.events) {
      const itemId = normalizeText(sourceEvent.itemId);
      if (!itemId) {
        continue;
      }

      const eventKey = itemId;
      const existingEvent = await ctx.db
        .query("events")
        .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
        .unique();

      const branch = [];
      for (const [index, value] of sourceEvent.branch.entries()) {
        const storedValue = await ensureLabelOption(ctx, "branch", value, index);
        if (storedValue) {
          branch.push(storedValue);
        }
      }

      const products = [];
      for (const [index, value] of sourceEvent.products.entries()) {
        const storedValue = await ensureLabelOption(ctx, "products", value, index);
        if (storedValue) {
          products.push(storedValue);
        }
      }

      const attendants = [];
      for (const [index, value] of sourceEvent.attendants.entries()) {
        const storedValue = await ensureLabelOption(ctx, "attendants", value, index);
        if (storedValue) {
          attendants.push(storedValue);
        }
      }

      const status = await ensureLabelOption(ctx, "status", sourceEvent.status || "", 0);
      const paymentStatus = await ensureLabelOption(ctx, "paymentStatus", sourceEvent.paymentStatus || "", 0);
      const vinyl = await ensureLabelOption(ctx, "vinyl", sourceEvent.vinyl || "", 0);
      const gsAi = await ensureLabelOption(ctx, "gsAi", sourceEvent.gsAi || "", 0);
      const imagesSent = await ensureLabelOption(ctx, "imagesSent", sourceEvent.imagesSent || "", 0);
      const snappic = await ensureLabelOption(ctx, "snappic", sourceEvent.snappic || "", 0);

      const payload = {
        eventKey,
        workspaceYear: args.workspaceYear,
        name: normalizeText(sourceEvent.name),
        date: normalizeText(sourceEvent.date),
        draftMonth: normalizeText(sourceEvent.date) ? "" : monthName,
        hours: normalizeText(sourceEvent.hours),
        branch: uniqueList(branch),
        products: uniqueList(products),
        status,
        location: normalizeText(sourceEvent.location),
        paymentStatus,
        vinyl,
        gsAi,
        imagesSent,
        snappic,
        attendants: uniqueList(attendants),
        exVat: sourceEvent.exVat ?? "",
        packageOnly: normalizeText(sourceEvent.packageOnly),
        updatedAt: Date.now(),
      };

      let eventId = existingEvent?._id;
      if (existingEvent) {
        await ctx.db.patch(existingEvent._id, {
          ...payload,
        });
        updatedEvents += 1;
      } else {
        eventId = await ctx.db.insert("events", {
          ...payload,
          notes: "",
          customFields: {},
          updates: [],
          files: [],
          activity: [],
          createdByUserId: importingUser?._id,
          createdAt: Date.now(),
        });
        createdEvents += 1;
      }

      const linkedUpdates = (updatesByItemId.get(itemId) || []).sort((left, right) => left.createdAt - right.createdAt);
      if (!linkedUpdates.length) {
        continue;
      }

      const existingUpdateEntries = await ctx.db
        .query("eventUpdates")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
      const existingLegacyIds = new Set(existingUpdateEntries.map((entry) => entry.legacyEntryId).filter(Boolean));

      for (const update of linkedUpdates) {
        const legacyEntryId = makeLegacyUpdateKey(itemId, update.createdAt, update.actorName, update.body);
        if (existingLegacyIds.has(legacyEntryId)) {
          continue;
        }

        await ctx.db.insert("eventUpdates", {
          eventId,
          body: normalizeText(update.body),
          actorName: normalizeText(update.actorName) || "Unknown user",
          legacyEntryId,
          createdAt: update.createdAt,
        });

        await ctx.db.insert("activityLog", {
          workspaceYear: args.workspaceYear,
          eventId,
          eventName: normalizeText(sourceEvent.name),
          text: `Imported update: ${normalizeText(update.body)}`,
          shortText: shortActivity(normalizeText(sourceEvent.name), `Imported update: ${normalizeText(update.body)}`),
          actorName: normalizeText(update.actorName) || "Unknown user",
          legacyEntryId: `activity|${legacyEntryId}`,
          createdAt: update.createdAt,
        });

        existingLegacyIds.add(legacyEntryId);
        insertedUpdates += 1;
      }
    }

    return {
      month: monthName,
      createdEvents,
      updatedEvents,
      insertedUpdates,
    };
  },
});

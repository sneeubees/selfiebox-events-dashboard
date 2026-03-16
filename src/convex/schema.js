import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const eventEntry = v.object({
  id: v.string(),
  text: v.string(),
  user: v.string(),
  date: v.string(),
});

const eventFile = v.object({
  id: v.string(),
  name: v.string(),
  type: v.string(),
  size: v.string(),
});

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.string(),
    surname: v.string(),
    fullName: v.string(),
    designation: v.string(),
    role: v.union(v.literal("admin"), v.literal("manager"), v.literal("user")),
    profilePic: v.optional(v.string()),
    monthOrder: v.optional(v.array(v.string())),
    isApproved: v.boolean(),
    isActive: v.boolean(),
    lastSignInAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),
  workspaces: defineTable({
    year: v.number(),
    name: v.string(),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_year", ["year"]),
  events: defineTable({
    eventKey: v.string(),
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
    locationLat: v.optional(v.number()),
    locationLng: v.optional(v.number()),
    paymentStatus: v.optional(v.string()),
    vinyl: v.optional(v.string()),
    gsAi: v.optional(v.string()),
    imagesSent: v.optional(v.string()),
    snappic: v.optional(v.string()),
    attendants: v.array(v.string()),
    exVat: v.optional(v.union(v.number(), v.string())),
    packageOnly: v.optional(v.string()),
    notes: v.optional(v.string()),
    customFields: v.optional(v.record(v.string(), v.union(v.string(), v.array(v.string())))),
    updates: v.array(eventEntry),
    files: v.array(eventFile),
    activity: v.array(eventEntry),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event_key", ["eventKey"])
    .index("by_workspace_year", ["workspaceYear"])
    .index("by_date", ["date"]),
  labelOptions: defineTable({
    columnKey: v.string(),
    optionKey: v.string(),
    name: v.string(),
    abbreviation: v.optional(v.string()),
    color: v.string(),
    order: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_column", ["columnKey"])
    .index("by_column_option_key", ["columnKey", "optionKey"]),
  eventUpdates: defineTable({
    eventId: v.id("events"),
    body: v.string(),
    actorName: v.string(),
    legacyEntryId: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),
  eventFiles: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    storageId: v.optional(v.id("_storage")),
    legacyFileId: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeLabel: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),
  activityLog: defineTable({
    workspaceYear: v.number(),
    eventId: v.optional(v.id("events")),
    eventName: v.optional(v.string()),
    text: v.string(),
    shortText: v.string(),
    actorName: v.string(),
    legacyEntryId: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_workspace_year", ["workspaceYear"])
    .index("by_event", ["eventId"]),
  columnPermissions: defineTable({
    columnKey: v.string(),
    subjectType: v.union(v.literal("role"), v.literal("user")),
    role: v.optional(v.union(v.literal("admin"), v.literal("manager"), v.literal("user"))),
    userId: v.optional(v.id("users")),
    canView: v.boolean(),
    canEdit: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_column", ["columnKey"])
    .index("by_column_role", ["columnKey", "role"])
    .index("by_column_user", ["columnKey", "userId"]),
  customColumns: defineTable({
    columnKey: v.string(),
    label: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("number"),
      v.literal("date"),
      v.literal("singleItem"),
      v.literal("multiItem"),
    ),
    order: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_column_key", ["columnKey"])
    .index("by_order", ["order"]),
});

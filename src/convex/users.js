import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_WORKSPACE_YEARS = [2026, 2027];
const PRIMARY_ADMIN_EMAIL = "info@selfiebox.co.za";

async function requireIdentity(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity;
}

async function getCurrentUserRecord(ctx) {
  const identity = await requireIdentity(ctx);
  const clerkId = identity.subject ?? identity.tokenIdentifier;
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();

  return { identity, clerkId, user };
}

async function findUsersByEmail(ctx, email) {
  const normalizedEmail = email.trim().toLowerCase();
  return (await ctx.db.query("users").collect()).filter((record) => record.email === normalizedEmail);
}

function pickCanonicalUser(users, preferredClerkId) {
  return users.slice().sort((left, right) => {
    if (preferredClerkId) {
      if (left.clerkId === preferredClerkId && right.clerkId !== preferredClerkId) return -1;
      if (right.clerkId === preferredClerkId && left.clerkId !== preferredClerkId) return 1;
    }
    if (left.role === "admin" && right.role !== "admin") return -1;
    if (right.role === "admin" && left.role !== "admin") return 1;
    return left.createdAt - right.createdAt;
  })[0] || null;
}

async function mergeDuplicateUsers(ctx, canonicalUser, duplicateUsers) {
  for (const duplicate of duplicateUsers) {
    if (!duplicate || duplicate._id === canonicalUser._id) {
      continue;
    }

    const workspaces = await ctx.db.query("workspaces").collect();
    for (const workspace of workspaces) {
      if (workspace.createdByUserId === duplicate._id) {
        await ctx.db.patch(workspace._id, { createdByUserId: canonicalUser._id });
      }
    }

    const events = await ctx.db.query("events").collect();
    for (const event of events) {
      if (event.createdByUserId === duplicate._id) {
        await ctx.db.patch(event._id, { createdByUserId: canonicalUser._id });
      }
    }

    const updates = await ctx.db.query("eventUpdates").collect();
    for (const update of updates) {
      if (update.createdByUserId === duplicate._id) {
        await ctx.db.patch(update._id, { createdByUserId: canonicalUser._id });
      }
    }

    const files = await ctx.db.query("eventFiles").collect();
    for (const file of files) {
      if (file.createdByUserId === duplicate._id) {
        await ctx.db.patch(file._id, { createdByUserId: canonicalUser._id });
      }
    }

    const activityEntries = await ctx.db.query("activityLog").collect();
    for (const entry of activityEntries) {
      if (entry.actorUserId === duplicate._id) {
        await ctx.db.patch(entry._id, { actorUserId: canonicalUser._id });
      }
    }

    const permissions = await ctx.db.query("columnPermissions").collect();
    for (const permission of permissions) {
      if (permission.userId === duplicate._id) {
        const existingForCanonical = permissions.find(
          (candidate) =>
            candidate._id !== permission._id &&
            candidate.columnKey === permission.columnKey &&
            candidate.subjectType === permission.subjectType &&
            candidate.userId === canonicalUser._id
        );
        if (existingForCanonical) {
          await ctx.db.delete(permission._id);
        } else {
          await ctx.db.patch(permission._id, { userId: canonicalUser._id });
        }
      }
    }

    await ctx.db.delete(duplicate._id);
  }
}

async function ensureWorkspaceYears(ctx, createdByUserId) {
  for (const year of DEFAULT_WORKSPACE_YEARS) {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_year", (q) => q.eq("year", year))
      .unique();

    if (!existing) {
      await ctx.db.insert("workspaces", {
        year,
        name: String(year),
        createdByUserId,
        createdAt: Date.now(),
      });
    }
  }
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function toUserDto(record) {
  if (!record) {
    return null;
  }

  return {
    id: record._id,
    clerkId: record.clerkId,
    email: record.email,
    firstName: record.firstName,
    surname: record.surname,
    designation: record.designation,
    profilePic: record.profilePic || "",
      monthOrder: Array.isArray(record.monthOrder) && record.monthOrder.length === monthNames.length ? record.monthOrder : monthNames,
    role: record.role,
    isApproved: record.isApproved,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export const syncCurrentUser = mutation({
  args: {
    email: v.string(),
    firstName: v.string(),
    surname: v.string(),
    profilePic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity, clerkId, user } = await getCurrentUserRecord(ctx);
    const email = args.email.trim().toLowerCase();
    const isPrimaryAdmin = email === PRIMARY_ADMIN_EMAIL;
    const firstName = args.firstName.trim() || identity.givenName || "User";
    const surname = args.surname.trim() || identity.familyName || "";
    const now = Date.now();
    const emailMatches = await findUsersByEmail(ctx, email);

    if (user) {
      const duplicates = emailMatches.filter((candidate) => candidate._id !== user._id);
      const nextFirstName = user.firstName || firstName;
      const nextSurname = user.surname || surname;
      await ctx.db.patch(user._id, {
        email,
        firstName: nextFirstName,
        surname: nextSurname,
        fullName: `${nextFirstName} ${nextSurname}`.trim(),
        designation: isPrimaryAdmin ? "Operations Admin" : user.designation,
        profilePic: user.profilePic || args.profilePic || "",
        monthOrder: Array.isArray(user.monthOrder) && user.monthOrder.length === monthNames.length ? user.monthOrder : monthNames,
        role: isPrimaryAdmin ? "admin" : user.role,
        isApproved: isPrimaryAdmin ? true : user.isApproved,
        isActive: isPrimaryAdmin ? true : user.isActive,
        lastSignInAt: now,
        updatedAt: now,
      });

      if (duplicates.length > 0) {
        await mergeDuplicateUsers(ctx, user, duplicates);
      }

      const refreshed = await ctx.db.get(user._id);
      return toUserDto(refreshed);
    }

    const existingByEmail = pickCanonicalUser(emailMatches, clerkId);
    if (existingByEmail) {
      await ctx.db.patch(existingByEmail._id, {
        clerkId,
        email,
        firstName: existingByEmail.firstName || firstName,
        surname: existingByEmail.surname || surname,
        fullName: `${existingByEmail.firstName || firstName} ${existingByEmail.surname || surname}`.trim(),
        designation: isPrimaryAdmin ? "Operations Admin" : existingByEmail.designation,
        profilePic: existingByEmail.profilePic || args.profilePic || "",
        monthOrder: Array.isArray(existingByEmail.monthOrder) && existingByEmail.monthOrder.length === monthNames.length ? existingByEmail.monthOrder : monthNames,
        role: isPrimaryAdmin ? "admin" : existingByEmail.role,
        isApproved: isPrimaryAdmin ? true : existingByEmail.isApproved,
        isActive: isPrimaryAdmin ? true : existingByEmail.isActive,
        lastSignInAt: now,
        updatedAt: now,
      });
      await mergeDuplicateUsers(
        ctx,
        existingByEmail,
        emailMatches.filter((candidate) => candidate._id !== existingByEmail._id)
      );
      return toUserDto(await ctx.db.get(existingByEmail._id));
    }

    const existingUsers = await ctx.db.query("users").collect();
    const isFirstUser = existingUsers.length === 0;
    const shouldBootstrapAdmin = isFirstUser || isPrimaryAdmin;

    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName,
      surname,
      fullName: `${firstName} ${surname}`.trim(),
      designation: shouldBootstrapAdmin ? "Operations Admin" : "Coordinator",
      role: shouldBootstrapAdmin ? "admin" : "user",
      profilePic: args.profilePic || "",
      monthOrder: monthNames,
      isApproved: shouldBootstrapAdmin,
      isActive: shouldBootstrapAdmin,
      lastSignInAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ensureWorkspaceYears(ctx, userId);

    return toUserDto(await ctx.db.get(userId));
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const clerkId = identity.subject ?? identity.tokenIdentifier;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    return toUserDto(user);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user || user.role !== "admin") {
      return [];
    }

    const users = await ctx.db.query("users").collect();
    return users
      .sort((left, right) => left.firstName.localeCompare(right.firstName))
      .map(toUserDto);
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    firstName: v.string(),
    surname: v.string(),
    designation: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("manager"), v.literal("user")),
    profilePic: v.optional(v.string()),
    isApproved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user || user.role !== "admin") {
      throw new Error("Only admins can update users.");
    }

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new Error("User not found.");
    }

    await ctx.db.patch(args.userId, {
      firstName: args.firstName.trim() || target.firstName,
      surname: args.surname.trim() || target.surname,
      fullName: `${args.firstName.trim() || target.firstName} ${args.surname.trim() || target.surname}`.trim(),
      designation: args.designation.trim() || target.designation,
      email: args.email.trim().toLowerCase() || target.email,
      role: args.role,
      profilePic: args.profilePic || "",
      isApproved: args.isApproved,
      isActive: args.isApproved,
      updatedAt: Date.now(),
    });

    return toUserDto(await ctx.db.get(args.userId));
  },
});

export const updateMyProfile = mutation({
  args: {
    firstName: v.string(),
    surname: v.string(),
    designation: v.string(),
    profilePic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("User not found.");
    }

    await ctx.db.patch(user._id, {
      firstName: args.firstName.trim() || user.firstName,
      surname: args.surname.trim() || user.surname,
      fullName: `${args.firstName.trim() || user.firstName} ${args.surname.trim() || user.surname}`.trim(),
      designation: args.designation.trim() || user.designation,
      profilePic: args.profilePic || "",
      updatedAt: Date.now(),
    });

    return toUserDto(await ctx.db.get(user._id));
  },
});

export const updateMonthOrder = mutation({
  args: {
    monthOrder: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user) {
      throw new Error("User not found.");
    }

    const cleanedOrder = monthNames.filter((month) => args.monthOrder.includes(month));
    if (cleanedOrder.length !== monthNames.length) {
      throw new Error("Month order is invalid.");
    }

    await ctx.db.patch(user._id, {
      monthOrder: cleanedOrder,
      updatedAt: Date.now(),
    });

    return toUserDto(await ctx.db.get(user._id));
  },
});

export const remove = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user || user.role !== "admin") {
      throw new Error("Only admins can delete users.");
    }

    if (user._id === args.userId) {
      throw new Error("You cannot delete your own account from here.");
    }

    const target = await ctx.db.get(args.userId);
    if (!target) {
      return null;
    }

    await ctx.db.delete(args.userId);
    return toUserDto(target);
  },
});

export const bootstrapPrimaryAdmin = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    surname: v.optional(v.string()),
    profilePic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (email !== PRIMARY_ADMIN_EMAIL) {
      throw new Error("This bootstrap is only allowed for the primary admin email.");
    }

    const firstName = args.firstName?.trim() || "Info";
    const surname = args.surname?.trim() || "SelfieBox";
    const now = Date.now();

    const existingByClerkId = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (existingByClerkId) {
      await ctx.db.patch(existingByClerkId._id, {
        email,
        firstName,
        surname,
        fullName: `${firstName} ${surname}`.trim(),
        designation: "Operations Admin",
        role: "admin",
        profilePic: args.profilePic || existingByClerkId.profilePic || "",
        monthOrder: Array.isArray(existingByClerkId.monthOrder) && existingByClerkId.monthOrder.length === monthNames.length ? existingByClerkId.monthOrder : monthNames,
        isApproved: true,
        isActive: true,
        lastSignInAt: now,
        updatedAt: now,
      });
      await mergeDuplicateUsers(
        ctx,
        existingByClerkId,
        (await findUsersByEmail(ctx, email)).filter((candidate) => candidate._id !== existingByClerkId._id)
      );
      return toUserDto(await ctx.db.get(existingByClerkId._id));
    }

    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existingByEmail) {
      await ctx.db.patch(existingByEmail._id, {
        clerkId: args.clerkId,
        email,
        firstName,
        surname,
        fullName: `${firstName} ${surname}`.trim(),
        designation: "Operations Admin",
        role: "admin",
        profilePic: args.profilePic || existingByEmail.profilePic || "",
        monthOrder: Array.isArray(existingByEmail.monthOrder) && existingByEmail.monthOrder.length === monthNames.length ? existingByEmail.monthOrder : monthNames,
        isApproved: true,
        isActive: true,
        lastSignInAt: now,
        updatedAt: now,
      });
      await mergeDuplicateUsers(
        ctx,
        existingByEmail,
        (await findUsersByEmail(ctx, email)).filter((candidate) => candidate._id !== existingByEmail._id)
      );
      return toUserDto(await ctx.db.get(existingByEmail._id));
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email,
      firstName,
      surname,
      fullName: `${firstName} ${surname}`.trim(),
      designation: "Operations Admin",
      role: "admin",
      profilePic: args.profilePic || "",
      monthOrder: monthNames,
      isApproved: true,
      isActive: true,
      lastSignInAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ensureWorkspaceYears(ctx, userId);
    const createdUser = await ctx.db.get(userId);
    await mergeDuplicateUsers(
      ctx,
      createdUser,
      (await findUsersByEmail(ctx, email)).filter((candidate) => candidate._id !== userId)
    );
    return toUserDto(await ctx.db.get(userId));
  },
});

export const cleanupDuplicateEmails = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await getCurrentUserRecord(ctx);
    if (!user || user.role !== "admin") {
      throw new Error("Only admins can clean up duplicate users.");
    }

    const allUsers = await ctx.db.query("users").collect();
    const grouped = new Map();
    for (const record of allUsers) {
      const email = record.email.trim().toLowerCase();
      const list = grouped.get(email) || [];
      list.push(record);
      grouped.set(email, list);
    }

    let cleaned = 0;
    for (const [email, records] of grouped.entries()) {
      if (records.length < 2) {
        continue;
      }
      const canonical = pickCanonicalUser(records, email === PRIMARY_ADMIN_EMAIL ? user.clerkId : undefined);
      const duplicates = records.filter((record) => record._id !== canonical._id);
      await mergeDuplicateUsers(ctx, canonical, duplicates);
      cleaned += duplicates.length;
    }

    return { cleaned };
  },
});

"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

export const removeWithClerk = action({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUser = await ctx.runQuery(api.users.current, {});
    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Only admins can delete users.");
    }

    const users = await ctx.runQuery(api.users.list, {});
    const target = users.find((user) => user.id === args.userId);
    if (!target) {
      return null;
    }

    if (target.id === currentUser.id) {
      throw new Error("You cannot delete your own account from here.");
    }

    if (target.clerkId) {
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      if (!clerkSecretKey) {
        throw new Error("Missing CLERK_SECRET_KEY in Convex production environment.");
      }

      const response = await fetch(`https://api.clerk.com/v1/users/${target.clerkId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${clerkSecretKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok && response.status !== 404) {
        const body = await response.text();
        throw new Error(`Failed to delete Clerk user: ${response.status} ${body}`);
      }
    }

    return await ctx.runMutation(internal.users.removeLocalUser, {
      userId: args.userId,
    });
  },
});

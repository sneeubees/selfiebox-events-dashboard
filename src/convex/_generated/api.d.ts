/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminUsers from "../adminUsers.js";
import type * as collaboration from "../collaboration.js";
import type * as columns from "../columns.js";
import type * as documentNumbers from "../documentNumbers.js";
import type * as events from "../events.js";
import type * as files from "../files.js";
import type * as imports from "../imports.js";
import type * as labels from "../labels.js";
import type * as maintenance from "../maintenance.js";
import type * as notifications from "../notifications.js";
import type * as permissions from "../permissions.js";
import type * as staticColumnLabels from "../staticColumnLabels.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminUsers: typeof adminUsers;
  collaboration: typeof collaboration;
  columns: typeof columns;
  documentNumbers: typeof documentNumbers;
  events: typeof events;
  files: typeof files;
  imports: typeof imports;
  labels: typeof labels;
  maintenance: typeof maintenance;
  notifications: typeof notifications;
  permissions: typeof permissions;
  staticColumnLabels: typeof staticColumnLabels;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

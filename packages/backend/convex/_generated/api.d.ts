/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as deviceTokens from "../deviceTokens.js";
import type * as documents from "../documents.js";
import type * as events from "../events.js";
import type * as issues from "../issues.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_format from "../lib/format.js";
import type * as lib_token from "../lib/token.js";
import type * as lib_write from "../lib/write.js";
import type * as sync from "../sync.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  deviceTokens: typeof deviceTokens;
  documents: typeof documents;
  events: typeof events;
  issues: typeof issues;
  "lib/auth": typeof lib_auth;
  "lib/format": typeof lib_format;
  "lib/token": typeof lib_token;
  "lib/write": typeof lib_write;
  sync: typeof sync;
  teams: typeof teams;
  users: typeof users;
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

export declare const components: {
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
};

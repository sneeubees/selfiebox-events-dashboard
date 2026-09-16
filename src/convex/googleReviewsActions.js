"use node";
import { randomBytes, createHash } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { allPages, googleGet, locationResource } from "./googleReviewsClient";

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const hash = value => createHash("sha256").update(value).digest("base64url");
function config() {
  const clientId = process.env.GBP_OAUTH_CLIENT_ID || process.env.GA4_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GBP_OAUTH_CLIENT_SECRET || process.env.GA4_OAUTH_CLIENT_SECRET;
  const redirect = process.env.GBP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) throw new Error("Google Reviews OAuth is not configured yet.");
  if (!redirect.startsWith("https://")) throw new Error("Google Reviews requires an HTTPS callback.");
  return { clientId, clientSecret, redirect };
}
async function authorise(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return ctx.runQuery(internal.googleReviews.authorise, {
    subject: identity.subject ?? identity.tokenIdentifier, email: identity.email || "",
  });
}
async function exchange(body) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Google authorization failed. Reconnect Google Reviews.");
  return data;
}
async function accessToken(ctx) {
  const { refreshToken } = await authorise(ctx);
  if (!refreshToken) throw new Error("Connect Google Reviews first.");
  const { clientId, clientSecret } = config();
  const data = await exchange({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  return data.access_token;
}
export const connect = action({
  args: {},
  handler: async ctx => {
    const { userId } = await authorise(ctx);
    const { clientId, redirect } = config();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.googleReviews.saveState, { digest: hash(state), verifier, userId });
    return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", state,
      code_challenge: hash(verifier), code_challenge_method: "S256",
    });
  },
});
export const callback = internalAction({
  args: { state: v.string(), code: v.string(), denied: v.boolean() },
  handler: async (ctx, args) => {
    const { verifier, userId } = await ctx.runMutation(internal.googleReviews.consumeState, { digest: hash(args.state) });
    if (args.denied || !args.code) throw new Error("Google connection cancelled.");
    const { clientId, clientSecret, redirect } = config();
    const token = await exchange({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirect,
      grant_type: "authorization_code", code: args.code, code_verifier: verifier });
    if (!String(token.scope || "").split(" ").includes(SCOPE)) throw new Error("Business Profile permission was not granted.");
    if (!token.refresh_token) throw new Error("Google did not return offline access. Reconnect Google Reviews.");
    await ctx.runMutation(internal.googleReviews.saveToken, { refreshToken: token.refresh_token, userId });
  },
});
export const profiles = action({
  args: {},
  handler: async ctx => {
    const token = await accessToken(ctx);
    const accounts = await allPages("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", "accounts", token);
    const profiles = new Map();
    const errors = [];
    for (const account of accounts) {
      if (!/^accounts\/[0-9]+$/.test(account.name)) continue;
      try {
        const locations = await allPages(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress,metadata&pageSize=100`, "locations", token);
        for (const location of locations) {
          if (!/^locations\/[0-9]+$/.test(location.name)) continue;
          profiles.set(location.name, { resource: `${account.name}/${location.name}`, title: location.title,
            address: location.storefrontAddress || null, mapsUrl: location.metadata?.mapsUri || "",
            reviewUrl: location.metadata?.newReviewUri || "" });
        }
      } catch (error) { errors.push(`${account.accountName || account.name}: ${error.message}`); }
    }
    return { profiles: [...profiles.values()], errors };
  },
});
export const reviews = action({
  args: { location: v.string(), pageToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const token = await accessToken(ctx);
    const resource = locationResource(args.location);
    const url = new URL(`https://mybusiness.googleapis.com/v4/${resource}/reviews`);
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "updateTime desc");
    if (args.pageToken) {
      if (args.pageToken.length > 4096) throw new Error("Invalid page token");
      url.searchParams.set("pageToken", args.pageToken);
    }
    const data = await googleGet(url.toString(), token);
    return { reviews: data.reviews || [], averageRating: data.averageRating ?? null,
      totalReviewCount: data.totalReviewCount ?? 0, nextPageToken: data.nextPageToken || "", fetchedAt: Date.now() };
  },
});

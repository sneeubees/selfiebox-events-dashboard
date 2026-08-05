import { v } from "convex/values";
import { query, internalMutation, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";

// Sage Accounting (ZA) integration - OAuth app on developerselfservice.sageone.com.
// STAGING TEST PHASE: prove the pipe (consent -> tokens -> list companies).
// Endpoints are env-overridable because the ZA variant's docs are patchy:
//   SAGE_AUTH_URL   (default https://www.sageone.com/oauth2/auth/central)
//   SAGE_TOKEN_URL  (default https://oauth.accounting.sage.com/token)
//   SAGE_API_BASE   (default https://accounting.sageone.co.za/api/2.0.0)
// NOTE: Sage refresh tokens ROTATE on every use - each refresh must persist the
// newly issued refresh token or the connection dies.

const DEFAULTS = {
  authUrl: "https://www.sageone.com/oauth2/auth/central",
  tokenUrl: "https://oauth.accounting.sage.com/token",
  apiBase: "https://accounting.sageone.co.za/api/2.0.0",
};
const cfg = () => ({
  authUrl: process.env.SAGE_AUTH_URL || DEFAULTS.authUrl,
  tokenUrl: process.env.SAGE_TOKEN_URL || DEFAULTS.tokenUrl,
  apiBase: process.env.SAGE_API_BASE || DEFAULTS.apiBase,
});

export const getConnectUrl = query({
  args: {},
  handler: async () => {
    const clientId = process.env.SAGE_CLIENT_ID;
    const redirect = process.env.SAGE_REDIRECT_URI;
    const state = process.env.SAGE_OAUTH_STATE;
    if (!clientId || !redirect || !state) return null;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "full_access",
      scopes: "full_access",
      filter: "apiv2",
      state,
    });
    return `${cfg().authUrl}?${params.toString()}`;
  },
});

export const storeTokens = internalMutation({
  args: { refreshToken: v.string(), meta: v.optional(v.string()) },
  handler: async (ctx, { refreshToken, meta }) => {
    const now = Date.now();
    const existing = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "sage")).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { refreshToken, connectedByEmail: meta || existing.connectedByEmail || "", updatedAt: now });
    } else {
      await ctx.db.insert("integrations", { key: "sage", refreshToken, connectedByEmail: meta || "", connectedAt: now, updatedAt: now });
    }
    return { ok: true };
  },
});

export const getTokenRaw = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "sage")).unique();
    return row ? row.refreshToken : null;
  },
});

async function refreshAccessToken(ctx, refreshToken) {
  const res = await fetch(cfg().tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SAGE_CLIENT_ID,
      client_secret: process.env.SAGE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("sage token refresh failed: " + JSON.stringify(json).slice(0, 300));
  // rotation: persist the NEW refresh token immediately
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    await ctx.runMutation(internal.sage.storeTokens, { refreshToken: json.refresh_token });
  }
  return json.access_token;
}

// CLI smoke test: `convex run sage:testFetch` after connecting.
// Tries Company/Get on the ZA API to prove auth + list companies.
export const testFetch = action({
  args: { path: v.optional(v.string()) },
  handler: async (ctx, { path }) => {
    const refreshToken = await ctx.runQuery(internal.sage.getTokenRaw, {});
    if (!refreshToken) return { ok: false, error: "Sage not connected yet - open the connect URL first." };
    const accessToken = await refreshAccessToken(ctx, refreshToken);
    const url = `${cfg().apiBase}/${path || "Company/Get"}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    return { ok: res.ok, status: res.status, url, body: typeof body === "string" ? body : JSON.stringify(body).slice(0, 1200) };
  },
});

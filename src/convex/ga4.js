import { v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

// ---------- auth helpers ----------
async function findUser(ctx, clerkId, email) {
  let user = clerkId
    ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique()
    : null;
  if (!user && email) {
    const lower = String(email).trim().toLowerCase();
    user = (await ctx.db.query("users").collect()).find((u) => u.email === lower) || null;
  }
  return user;
}

async function requireAdminFromCtx(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await findUser(ctx, identity.subject ?? identity.tokenIdentifier, identity.email || "");
  if (!user || !user.isApproved || !user.isActive) throw new Error("Not authorised");
  if (user.role !== "admin") throw new Error("Admins only");
  return user;
}

// ---------- client-facing: connection ----------
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireAdminFromCtx(ctx);
    } catch {
      return { canManage: false, connected: false };
    }
    const row = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "ga4")).unique();
    return {
      canManage: true,
      connected: Boolean(row),
      connectedByEmail: row?.connectedByEmail || "",
      connectedAt: row?.connectedAt || null,
      propertyId: process.env.GA4_PROPERTY_ID || "",
    };
  },
});

export const getConnectUrl = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminFromCtx(ctx);
    const clientId = process.env.GA4_OAUTH_CLIENT_ID;
    const redirect = process.env.GA4_REDIRECT_URI;
    const state = process.env.GA4_OAUTH_STATE;
    if (!clientId || !redirect || !state) throw new Error("GA4 OAuth env not configured");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminFromCtx(ctx);
    const row = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "ga4")).unique();
    if (row) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

// ---------- internal: token storage (called by the OAuth callback) ----------
export const storeRefreshToken = internalMutation({
  args: { refreshToken: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "ga4")).unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        refreshToken: args.refreshToken,
        connectedByEmail: args.email || existing.connectedByEmail || "",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("integrations", {
        key: "ga4",
        refreshToken: args.refreshToken,
        connectedByEmail: args.email || "",
        connectedAt: now,
        updatedAt: now,
      });
    }
    return { ok: true };
  },
});

export const getTokenIfAdmin = internalQuery({
  args: { clerkId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.clerkId, args.email);
    if (!user || !user.isApproved || !user.isActive || user.role !== "admin") {
      throw new Error("Admins only");
    }
    const row = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "ga4")).unique();
    return row ? row.refreshToken : null;
  },
});

// ---------- GA4 Data API ----------
async function accessTokenFromRefresh(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GA4_OAUTH_CLIENT_ID,
      client_secret: process.env.GA4_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error("token_refresh_failed:" + (json.error || res.status));
  }
  return json.access_token;
}

async function runReport(accessToken, propertyId, body) {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("ga4_report_failed:" + JSON.stringify(json.error || json).slice(0, 300));
  return json;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// pull a totals row (no dimensions) into a labelled object using the metric order
const TOTAL_METRICS = ["sessions", "totalUsers", "screenPageViews", "averageSessionDuration", "conversions"];
function parseTotals(report) {
  const row = report.rows && report.rows[0];
  const vals = row ? row.metricValues.map((m) => num(m.value)) : [0, 0, 0, 0, 0];
  return {
    sessions: vals[0],
    users: vals[1],
    pageviews: vals[2],
    avgEngagementSec: Math.round(vals[3]),
    conversions: vals[4],
  };
}

function totalsRequest(startDate, endDate) {
  return {
    dateRanges: [{ startDate, endDate }],
    metrics: TOTAL_METRICS.map((name) => ({ name })),
  };
}

export const getTokenRaw = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("integrations").withIndex("by_key", (q) => q.eq("key", "ga4")).unique();
    return row ? row.refreshToken : null;
  },
});

// Public entry point: admin-gated, then delegates to the internal fetcher.
export const getWebsiteStats = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { connected: false, canManage: false };
    try {
      const token = await ctx.runQuery(internal.ga4.getTokenIfAdmin, {
        clerkId: identity.subject ?? identity.tokenIdentifier ?? "",
        email: identity.email || "",
      });
      if (!token) return { connected: false, canManage: true };
    } catch {
      return { connected: false, canManage: false };
    }
    return await ctx.runAction(internal.ga4.fetchStats, {});
  },
});

// Internal: does the actual GA4 work (no auth) so it can be run standalone
// via `convex run ga4:fetchStats` for validation.
export const fetchStats = internalAction({
  args: {},
  handler: async (ctx) => {
    const refreshToken = await ctx.runQuery(internal.ga4.getTokenRaw, {});
    if (!refreshToken) return { connected: false, canManage: true };

    const propertyId = process.env.GA4_PROPERTY_ID;
    let accessToken;
    try {
      accessToken = await accessTokenFromRefresh(refreshToken);
    } catch (e) {
      return { connected: true, canManage: true, error: "reauth_needed", detail: String(e.message || e) };
    }

    const CONV_EVENTS = ["quote_submit", "contact_submit", "generate_lead", "Lead"];
    try {
      const [today, last7, last30, daily, pages, sources, convByEvent] = await Promise.all([
        runReport(accessToken, propertyId, totalsRequest("today", "today")),
        runReport(accessToken, propertyId, totalsRequest("6daysAgo", "today")),
        runReport(accessToken, propertyId, totalsRequest("29daysAgo", "today")),
        runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }],
          orderBys: [{ dimension: { dimensionName: "date" } }],
        }),
        runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }, { name: "averageSessionDuration" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 8,
        }),
        runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        }),
        runReport(accessToken, propertyId, {
          dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
          dimensions: [{ name: "eventName" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            filter: { fieldName: "eventName", inListFilter: { values: CONV_EVENTS } },
          },
          orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        }),
      ]);

      const daysRows = (daily.rows || []).map((r) => ({
        date: r.dimensionValues[0].value, // YYYYMMDD
        sessions: num(r.metricValues[0].value),
        users: num(r.metricValues[1].value),
      }));

      return {
        connected: true,
        canManage: true,
        fetchedAt: Date.now(),
        today: parseTotals(today),
        last7: parseTotals(last7),
        last30: parseTotals(last30),
        daily: daysRows,
        topPages: (pages.rows || []).map((r) => ({
          path: r.dimensionValues[0].value,
          views: num(r.metricValues[0].value),
          avgEngagementSec: Math.round(num(r.metricValues[1].value)),
        })),
        sources: (sources.rows || []).map((r) => ({
          channel: r.dimensionValues[0].value || "(none)",
          sessions: num(r.metricValues[0].value),
        })),
        conversionsByEvent: (convByEvent.rows || []).map((r) => ({
          event: r.dimensionValues[0].value,
          count: num(r.metricValues[0].value),
        })),
      };
    } catch (e) {
      return { connected: true, canManage: true, error: "report_failed", detail: String(e.message || e) };
    }
  },
});

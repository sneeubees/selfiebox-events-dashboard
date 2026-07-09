import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Google Ads API (REST searchStream). Reuses the SAME OAuth refresh token as
// GA4/Search Console (integrations key "ga4") — the connect flow now also asks
// for the adwords scope. Env (staging + live Convex): GOOGLE_ADS_DEVELOPER_TOKEN,
// GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC, digits only), GOOGLE_ADS_CUSTOMER_ID.
const ADS_API = "https://googleads.googleapis.com/v24";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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
    const err = new Error("token_refresh_failed:" + (json.error || res.status));
    err.tokenExpired = true;
    throw err;
  }
  return json.access_token;
}

async function searchStream(accessToken, gaql) {
  const customerId = String(process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/\D/g, "");
  const loginCustomerId = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  const res = await fetch(`${ADS_API}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      "login-customer-id": loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: gaql }),
  });
  const json = await res.json();
  if (!res.ok) {
    const raw = JSON.stringify(json).slice(0, 500);
    const err = new Error("ads_query_failed:" + raw);
    err.status = res.status;
    if (res.status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(raw)) err.needsScope = true;
    if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/i.test(raw)) err.notApproved = true;
    throw err;
  }
  // searchStream returns an array of chunks: [{ results: [...] }, ...]
  const chunks = Array.isArray(json) ? json : [json];
  return chunks.flatMap((c) => c.results || []);
}

const DEVICE_LABELS = { MOBILE: "Mobile", DESKTOP: "Desktop", TABLET: "Tablet", CONNECTED_TV: "TV", OTHER: "Other" };
const AGE_LABELS = {
  AGE_RANGE_18_24: "18–24", AGE_RANGE_25_34: "25–34", AGE_RANGE_35_44: "35–44",
  AGE_RANGE_45_54: "45–54", AGE_RANGE_55_64: "55–64", AGE_RANGE_65_UP: "65+",
  AGE_RANGE_UNDETERMINED: "Unknown",
};
const GENDER_LABELS = { MALE: "Male", FEMALE: "Female", UNDETERMINED: "Unknown" };

function sumRows(rows, pick) {
  const out = {};
  for (const row of rows) {
    const key = pick(row);
    if (!key) continue;
    const m = row.metrics || {};
    if (!out[key]) out[key] = { cost: 0, clicks: 0, impressions: 0, conversions: 0 };
    out[key].cost += num(m.costMicros) / 1e6;
    out[key].clicks += num(m.clicks);
    out[key].impressions += num(m.impressions);
    out[key].conversions += num(m.conversions);
  }
  return Object.entries(out)
    .map(([label, agg]) => ({ label, ...agg, cost: Math.round(agg.cost * 100) / 100 }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);
}

// Internal: does the actual Ads API work (no auth) so it can be run standalone
// via `convex run ads:fetchAds '{"startDate":"2026-07-01","endDate":"2026-07-08"}'`.
export const fetchAds = internalAction({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    const refreshToken = await ctx.runQuery(internal.ga4.getTokenRaw, {});
    if (!refreshToken) return { connected: false, canManage: true };
    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN || !process.env.GOOGLE_ADS_CUSTOMER_ID) {
      return { connected: true, canManage: true, error: "Google Ads env vars not configured." };
    }

    try {
      const accessToken = await accessTokenFromRefresh(refreshToken);
      const between = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;

      const [daily, campaigns, devices, ages, genders, geo] = await Promise.all([
        searchStream(accessToken,
          `SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE ${between} ORDER BY segments.date`),
        searchStream(accessToken,
          `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ${between} ORDER BY metrics.cost_micros DESC`),
        searchStream(accessToken,
          `SELECT segments.device, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE ${between}`),
        searchStream(accessToken,
          `SELECT ad_group_criterion.age_range.type, metrics.cost_micros, metrics.clicks, metrics.impressions FROM age_range_view WHERE ${between}`),
        searchStream(accessToken,
          `SELECT ad_group_criterion.gender.type, metrics.cost_micros, metrics.clicks, metrics.impressions FROM gender_view WHERE ${between}`),
        searchStream(accessToken,
          `SELECT segments.geo_target_region, metrics.cost_micros, metrics.clicks FROM geographic_view WHERE ${between}`),
      ]);

      // trend + totals
      const trend = daily.map((row) => ({
        label: String(row.segments?.date || ""),
        cost: Math.round((num(row.metrics?.costMicros) / 1e6) * 100) / 100,
        clicks: num(row.metrics?.clicks),
        impressions: num(row.metrics?.impressions),
        conversions: num(row.metrics?.conversions),
      }));
      const totals = trend.reduce(
        (acc, d) => ({
          cost: acc.cost + d.cost, clicks: acc.clicks + d.clicks,
          impressions: acc.impressions + d.impressions, conversions: acc.conversions + d.conversions,
        }),
        { cost: 0, clicks: 0, impressions: 0, conversions: 0 }
      );
      totals.cost = Math.round(totals.cost * 100) / 100;
      totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
      totals.avgCpc = totals.clicks ? totals.cost / totals.clicks : 0;
      totals.costPerConv = totals.conversions ? totals.cost / totals.conversions : 0;

      const campaignRows = campaigns
        .map((row) => ({
          name: String(row.campaign?.name || ""),
          status: String(row.campaign?.status || ""),
          cost: Math.round((num(row.metrics?.costMicros) / 1e6) * 100) / 100,
          clicks: num(row.metrics?.clicks),
          impressions: num(row.metrics?.impressions),
          conversions: num(row.metrics?.conversions),
        }))
        .filter((c) => c.cost > 0 || c.clicks > 0 || c.impressions > 0);

      // regions: resolve geoTargetConstants/<id> resource names -> readable names
      const regionAgg = sumRows(geo, (row) => String(row.segments?.geoTargetRegion || ""));
      let regions = [];
      if (regionAgg.length) {
        const ids = regionAgg.map((r) => r.label.split("/").pop()).filter((s) => /^\d+$/.test(s));
        let names = {};
        if (ids.length) {
          try {
            const lookup = await searchStream(accessToken,
              `SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.join(",")})`);
            names = Object.fromEntries(lookup.map((row) => [String(row.geoTargetConstant?.id), row.geoTargetConstant?.name || ""]));
          } catch { /* names stay as ids - non-fatal */ }
        }
        regions = regionAgg.map((r) => ({ ...r, label: names[r.label.split("/").pop()] || r.label })).slice(0, 10);
      }

      return {
        connected: true,
        canManage: true,
        totals,
        trend,
        campaigns: campaignRows,
        devices: sumRows(devices, (row) => DEVICE_LABELS[row.segments?.device] || row.segments?.device || ""),
        ages: sumRows(ages, (row) => AGE_LABELS[row.adGroupCriterion?.ageRange?.type] || ""),
        genders: sumRows(genders, (row) => GENDER_LABELS[row.adGroupCriterion?.gender?.type] || ""),
        regions,
      };
    } catch (e) {
      if (e.needsScope) return { connected: true, canManage: true, needsAdsScope: true };
      if (e.tokenExpired) return { connected: false, canManage: true, tokenExpired: true };
      if (e.notApproved) return { connected: true, canManage: true, error: "Developer token not yet approved for production accounts (Basic access pending)." };
      return { connected: true, canManage: true, error: String(e.message || e).slice(0, 300) };
    }
  },
});

export const getAdsStats = action({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
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
    return await ctx.runAction(internal.ads.fetchAds, args);
  },
});

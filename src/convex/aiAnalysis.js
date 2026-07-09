import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessTokenFromRefresh } from "./ga4";

// Weekly AI analysis of the whole marketing funnel: pulls DEEPER data than the
// dashboard views (GA4 weekly trends + leads-by-channel, Search Console query
// movements + ranking opportunities, Ads campaigns + search terms / wasted
// spend), sends the snapshot to the Claude API and stores a structured report.
// Runs from crons.js every Monday 05:00 UTC (07:00 SAST, gated on
// AI_CRON_ENABLED=1) and from the "Analyze now" button (startAnalysis).
const GA4_API = "https://analyticsdata.googleapis.com/v1beta";
const GSC_API = "https://www.googleapis.com/webmasters/v3";
const ADS_API = "https://googleads.googleapis.com/v24";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const LEAD_EVENTS = ["quote_submit", "contact_submit", "generate_lead", "Lead"];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function zaDay(offset) {
  return new Date(Date.now() - offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

// ---------- admin gating (same model as ga4.js) ----------
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

// ---------- source pulls (each throws on failure; gather() isolates) ----------
async function ga4Report(accessToken, body) {
  const res = await fetch(`${GA4_API}/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("ga4:" + JSON.stringify(json.error || json).slice(0, 200));
  return json.rows || [];
}

function ga4Rows(rows, dims, mets) {
  return rows.map((r) => {
    const out = {};
    dims.forEach((d, i) => { out[d] = r.dimensionValues?.[i]?.value ?? ""; });
    mets.forEach((m, i) => { out[m] = num(r.metricValues?.[i]?.value); });
    return out;
  });
}

async function pullGa4(accessToken) {
  const cur = { startDate: zaDay(27), endDate: zaDay(0) };
  const prev = { startDate: zaDay(55), endDate: zaDay(28) };
  const totalsBody = (range) => ({
    dateRanges: [range],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "averageSessionDuration" }],
  });
  const leadsBody = (range) => ({
    dateRanges: [range],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: LEAD_EVENTS } } },
  });
  const dimBody = (range, dim, metric, limit) => ({
    dateRanges: [range],
    dimensions: [{ name: dim }],
    metrics: [{ name: metric }],
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    limit: String(limit),
  });

  const [totalsCur, totalsPrev, leadsCur, leadsPrev, daily56, channels, leadsByChannel, pages, landing, devices, countries] = await Promise.all([
    ga4Report(accessToken, totalsBody(cur)),
    ga4Report(accessToken, totalsBody(prev)),
    ga4Report(accessToken, leadsBody(cur)),
    ga4Report(accessToken, leadsBody(prev)),
    ga4Report(accessToken, { dateRanges: [{ startDate: zaDay(55), endDate: zaDay(0) }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }] }),
    ga4Report(accessToken, dimBody(cur, "sessionDefaultChannelGroup", "sessions", 10)),
    ga4Report(accessToken, {
      dateRanges: [cur],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: LEAD_EVENTS } } },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    }),
    ga4Report(accessToken, dimBody(cur, "pagePath", "screenPageViews", 12)),
    ga4Report(accessToken, dimBody(cur, "landingPage", "sessions", 10)),
    ga4Report(accessToken, dimBody(cur, "deviceCategory", "sessions", 5)),
    ga4Report(accessToken, dimBody(cur, "country", "sessions", 8)),
  ]);

  // bucket 56 daily rows into 8 weeks (oldest -> newest)
  const dailySorted = ga4Rows(daily56, ["date"], ["sessions"]);
  const weekly = [];
  for (let w = 0; w < 8; w++) {
    const chunk = dailySorted.slice(w * 7, w * 7 + 7);
    if (chunk.length) weekly.push({ weekStart: chunk[0].date, sessions: chunk.reduce((s, d) => s + d.sessions, 0) });
  }

  const totals = (rows) => ({
    sessions: num(rows[0]?.metricValues?.[0]?.value),
    users: num(rows[0]?.metricValues?.[1]?.value),
    pageviews: num(rows[0]?.metricValues?.[2]?.value),
    avgSessionSec: Math.round(num(rows[0]?.metricValues?.[3]?.value)),
  });
  return {
    window: cur, previousWindow: prev,
    current: { ...totals(totalsCur), leads: num(leadsCur[0]?.metricValues?.[0]?.value) },
    previous: { ...totals(totalsPrev), leads: num(leadsPrev[0]?.metricValues?.[0]?.value) },
    weeklySessions: weekly,
    channels: ga4Rows(channels, ["channel"], ["sessions"]),
    leadsByChannel: ga4Rows(leadsByChannel, ["channel"], ["leadEvents"]),
    topPages: ga4Rows(pages, ["path"], ["views"]),
    topLandingPages: ga4Rows(landing, ["landingPage"], ["sessions"]),
    devices: ga4Rows(devices, ["device"], ["sessions"]),
    countries: ga4Rows(countries, ["country"], ["sessions"]),
  };
}

async function gscQuery(accessToken, site, body) {
  const res = await fetch(`${GSC_API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("gsc:" + JSON.stringify(json.error || json).slice(0, 200));
  return json.rows || [];
}

async function pullGsc(accessToken) {
  const sitesRes = await fetch(`${GSC_API}/sites`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const sites = (await sitesRes.json()).siteEntry || [];
  const site = (sites.find((s) => s.siteUrl === "sc-domain:selfiebox.co.za") || sites.find((s) => /selfiebox/.test(s.siteUrl)) || sites[0])?.siteUrl;
  if (!site) throw new Error("gsc:no verified Search Console property");
  // GSC data lags ~2-3 days, so both windows end 3 days back.
  const cur = { startDate: zaDay(30), endDate: zaDay(3) };
  const prev = { startDate: zaDay(58), endDate: zaDay(31) };
  const [totCur, totPrev, qCur, qPrev, pCur] = await Promise.all([
    gscQuery(accessToken, site, { ...cur }),
    gscQuery(accessToken, site, { ...prev }),
    gscQuery(accessToken, site, { ...cur, dimensions: ["query"], rowLimit: 100 }),
    gscQuery(accessToken, site, { ...prev, dimensions: ["query"], rowLimit: 100 }),
    gscQuery(accessToken, site, { ...cur, dimensions: ["page"], rowLimit: 10 }),
  ]);
  const tot = (rows) => ({
    clicks: num(rows[0]?.clicks), impressions: num(rows[0]?.impressions),
    ctr: Math.round(num(rows[0]?.ctr) * 1000) / 10, avgPosition: Math.round(num(rows[0]?.position) * 10) / 10,
  });
  const prevByQuery = Object.fromEntries(qPrev.map((r) => [r.keys[0], r]));
  const queries = qCur.slice(0, 20).map((r) => ({
    query: r.keys[0], clicks: num(r.clicks), impressions: num(r.impressions),
    position: Math.round(num(r.position) * 10) / 10,
    prevPosition: prevByQuery[r.keys[0]] ? Math.round(num(prevByQuery[r.keys[0]].position) * 10) / 10 : null,
  }));
  // ranking opportunities: meaningful impressions but sitting on page 1-bottom/page 2
  const opportunities = qCur
    .filter((r) => num(r.impressions) >= 80 && num(r.position) >= 8 && num(r.position) <= 25)
    .slice(0, 10)
    .map((r) => ({ query: r.keys[0], impressions: num(r.impressions), clicks: num(r.clicks), position: Math.round(num(r.position) * 10) / 10 }));
  return {
    site, window: cur, previousWindow: prev,
    current: tot(totCur), previous: tot(totPrev),
    topQueries: queries, rankingOpportunities: opportunities,
    topPages: pCur.map((r) => ({ page: r.keys[0], clicks: num(r.clicks), impressions: num(r.impressions) })),
  };
}

async function adsQuery(accessToken, gaql) {
  const cid = String(process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/\D/g, "");
  const login = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  const res = await fetch(`${ADS_API}/customers/${cid}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      "login-customer-id": login,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: gaql }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("ads:" + JSON.stringify(json).slice(0, 200));
  return (Array.isArray(json) ? json : [json]).flatMap((c) => c.results || []);
}

async function pullAds(accessToken) {
  const cur = `segments.date BETWEEN '${zaDay(29)}' AND '${zaDay(0)}'`;
  const prev = `segments.date BETWEEN '${zaDay(59)}' AND '${zaDay(30)}'`;
  const mets = "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions";
  const agg = (rows) => rows.reduce((a, r) => ({
    cost: a.cost + num(r.metrics?.costMicros) / 1e6, clicks: a.clicks + num(r.metrics?.clicks),
    impressions: a.impressions + num(r.metrics?.impressions), conversions: a.conversions + num(r.metrics?.conversions),
  }), { cost: 0, clicks: 0, impressions: 0, conversions: 0 });
  const [curTot, prevTot, campaigns, terms, devices] = await Promise.all([
    adsQuery(accessToken, `SELECT ${mets} FROM customer WHERE ${cur}`),
    adsQuery(accessToken, `SELECT ${mets} FROM customer WHERE ${prev}`),
    adsQuery(accessToken, `SELECT campaign.name, campaign.status, ${mets} FROM campaign WHERE ${cur} ORDER BY metrics.cost_micros DESC`),
    adsQuery(accessToken, `SELECT search_term_view.search_term, ${mets} FROM search_term_view WHERE ${cur} ORDER BY metrics.cost_micros DESC LIMIT 25`),
    adsQuery(accessToken, `SELECT segments.device, ${mets} FROM customer WHERE ${cur}`),
  ]);
  const round2 = (n) => Math.round(n * 100) / 100;
  const shape = (t) => ({ costR: round2(t.cost), clicks: t.clicks, impressions: t.impressions, conversions: round2(t.conversions) });
  return {
    window: { startDate: zaDay(29), endDate: zaDay(0) },
    current: shape(agg(curTot)), previous: shape(agg(prevTot)),
    campaigns: campaigns.map((r) => ({
      name: r.campaign?.name, status: r.campaign?.status,
      costR: round2(num(r.metrics?.costMicros) / 1e6), clicks: num(r.metrics?.clicks),
      impressions: num(r.metrics?.impressions), conversions: round2(num(r.metrics?.conversions)),
    })).filter((c) => c.costR > 0 || c.clicks > 0),
    searchTerms: terms.map((r) => ({
      term: r.searchTermView?.searchTerm,
      costR: round2(num(r.metrics?.costMicros) / 1e6), clicks: num(r.metrics?.clicks), conversions: round2(num(r.metrics?.conversions)),
    })),
    devices: devices.map((r) => ({
      device: r.segments?.device, costR: round2(num(r.metrics?.costMicros) / 1e6),
      clicks: num(r.metrics?.clicks), conversions: round2(num(r.metrics?.conversions)),
    })),
  };
}

// ---------- the analysis run ----------
const SYSTEM_PROMPT = `You are the growth analyst for SelfieBox (selfiebox.co.za), a South African photobooth-hire company serving weddings, corporate events and brand activations nationwide (branches incl. Gauteng, Cape Town, KZN). The business goal is QUOTE REQUESTS (leads) from the website. Currency is South African Rand (write amounts like "R 1 234").

You receive a JSON snapshot with three sources: "website" (Google Analytics; current vs previous 28-day window, weekly session trend, channels, leads-by-channel, pages, devices, countries), "seo" (Search Console; totals, query movements, ranking opportunities, pages) and "ads" (Google Ads; 30-day totals vs previous, campaigns, search terms by spend, devices). A source may instead contain an "error" string — acknowledge it briefly and analyse what is available.

Analyse holistically and be SPECIFIC: cite real numbers, name real queries/campaigns/pages, compare windows, compute derived figures (conversion rate, cost per lead) where useful. Look for: trend shifts, funnel leaks (traffic up but leads flat?), wasted ad spend (high-cost zero-conversion search terms), SEO quick wins (page-2 keywords worth pushing), device/geo mismatches. Recommendations must be concrete actions the owner can take this week, not generic advice.

Keep it tight: findings are single punchy sentences (max ~30 words each); 3-6 findings and 2-4 recommendations per section. Respond with ONLY valid JSON (no markdown, no code fences) exactly matching:
{"summary": string (2-4 sentences, plain English, the week's headline),
 "quickWins": string[] (max 4, most valuable immediate actions),
 "sections": [{"key": "website"|"seo"|"ads", "title": string, "health": "good"|"warn"|"bad",
   "findings": string[] (3-6, each citing numbers),
   "recommendations": [{"action": string, "why": string, "impact": "high"|"medium"|"low", "effort": "low"|"medium"|"high"}] (2-4)}]}`;

export const runAnalysis = internalAction({
  args: { reportId: v.id("aiReports") },
  handler: async (ctx, { reportId }) => {
    const fail = async (message) => {
      await ctx.runMutation(internal.aiAnalysis.finishReport, { reportId, status: "error", error: String(message).slice(0, 500) });
    };
    try {
      if (!process.env.ANTHROPIC_API_KEY) return await fail("ANTHROPIC_API_KEY is not configured on this backend yet.");
      const refreshToken = await ctx.runQuery(internal.ga4.getTokenRaw, {});
      if (!refreshToken) return await fail("Google is not connected on this backend (connect it on the Website Stats tab first).");
      const accessToken = await accessTokenFromRefresh(refreshToken);

      // isolate each source so one failure doesn't kill the whole report
      const [ga4, gsc, ads] = await Promise.all([
        pullGa4(accessToken).catch((e) => ({ error: String(e.message || e).slice(0, 200) })),
        pullGsc(accessToken).catch((e) => ({ error: String(e.message || e).slice(0, 200) })),
        pullAds(accessToken).catch((e) => ({ error: String(e.message || e).slice(0, 200) })),
      ]);
      if (ga4.error && gsc.error && ads.error) {
        return await fail(`All three sources failed. website: ${ga4.error} | seo: ${gsc.error} | ads: ${ads.error}`);
      }

      const snapshot = { generatedFor: zaDay(0), website: ga4, seo: gsc, ads };
      const res = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 12000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Here is this week's data snapshot:\n${JSON.stringify(snapshot)}` }],
        }),
      });
      const out = await res.json();
      if (!res.ok) return await fail("Claude API error: " + JSON.stringify(out.error || out).slice(0, 300));
      if (out.stop_reason === "max_tokens") return await fail("The model's report was cut off (max_tokens) — try again.");
      let text = (out.content || []).map((b) => b.text || "").join("").trim();
      // harden: strip any fences/preamble, keep the outermost JSON object
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) text = text.slice(first, last + 1);
      try { JSON.parse(text); } catch { /* UI falls back to raw text rendering */ }

      await ctx.runMutation(internal.aiAnalysis.finishReport, {
        reportId, status: "done", report: text, model: MODEL,
        periodLabel: `28 days to ${zaDay(0)}`,
      });
    } catch (e) {
      await fail(e.message || e);
    }
  },
});

export const finishReport = internalMutation({
  args: {
    reportId: v.id("aiReports"), status: v.string(),
    report: v.optional(v.string()), error: v.optional(v.string()),
    model: v.optional(v.string()), periodLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, {
      status: args.status, report: args.report, error: args.error,
      model: args.model, periodLabel: args.periodLabel, finishedAt: Date.now(),
    });
  },
});

async function kickOff(ctx, trigger) {
  // don't stack runs: skip if one started in the last 10 minutes is still running
  const latest = await ctx.db.query("aiReports").withIndex("by_created").order("desc").first();
  if (latest && latest.status === "running" && Date.now() - latest.createdAt < 10 * 60 * 1000) {
    return { ok: false, reason: "already_running" };
  }
  const reportId = await ctx.db.insert("aiReports", { createdAt: Date.now(), trigger, status: "running" });
  await ctx.scheduler.runAfter(0, internal.aiAnalysis.runAnalysis, { reportId });
  return { ok: true, reportId };
}

export const startAnalysis = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminFromCtx(ctx);
    return await kickOff(ctx, "manual");
  },
});

// Monday cron entry point — enabled per-backend via AI_CRON_ENABLED=1 so the
// weekly run fires on live only (staging keeps the manual button).
export const cronRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.AI_CRON_ENABLED !== "1") return { ok: false, reason: "cron_disabled" };
    return await kickOff(ctx, "cron");
  },
});

// CLI housekeeping only (internal — not client-callable): clears report history,
// e.g. junk runs from before a fix. `convex run aiAnalysis:purgeAll`.
export const purgeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiReports").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { deleted: rows.length };
  },
});

export const getReports = query({
  args: {},
  handler: async (ctx) => {
    try { await requireAdminFromCtx(ctx); } catch { return null; }
    const rows = await ctx.db.query("aiReports").withIndex("by_created").order("desc").take(20);
    return rows.map((r) => ({
      id: r._id, createdAt: r.createdAt, trigger: r.trigger, status: r.status,
      error: r.error || "", periodLabel: r.periodLabel || "", model: r.model || "",
    }));
  },
});

export const getReport = query({
  args: { id: v.id("aiReports") },
  handler: async (ctx, { id }) => {
    try { await requireAdminFromCtx(ctx); } catch { return null; }
    const r = await ctx.db.get(id);
    if (!r) return null;
    return {
      id: r._id, createdAt: r.createdAt, trigger: r.trigger, status: r.status,
      error: r.error || "", periodLabel: r.periodLabel || "", model: r.model || "",
      report: r.report || "",
    };
  },
});

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { sendQuoteEmails } from "./websiteQuoteEmail";
import { sendContactEmails } from "./websiteContactEmail";


async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) { console.error("TURNSTILE_SECRET not configured — allowing submission"); return true; }
  if (!token) return false;
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", String(token));
  if (ip) body.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SelfieBox/1.0" },
      body: body.toString(),
    });
    const j = await r.json();
    if (!j.success) console.warn("turnstile rejected:", JSON.stringify(j["error-codes"] || j));
    return !!j.success;
  } catch (e) {
    console.error("turnstile verify error", String(e));
    return false;
  }
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
    String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
}

const http = httpRouter();

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function getTokenFromRequest(request) {
  try {
    return String(new URL(request.url).searchParams.get("token") || "").trim();
  } catch {
    return "";
  }
}

http.route({
  path: "/website-quote",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }),
});

http.route({
  path: "/website-quote",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    try {
      const body = await request.json();
      if (body && body.website) {
        return Response.json({ ok: true, ref: "", refs: [] }, { status: 200, headers: corsHeaders(origin) });
      }
      const human = await verifyTurnstile(body && body.turnstileToken, clientIp(request));
      if (!human) {
        return Response.json({ ok: false, error: "Verification failed. Please try again." }, { status: 400, headers: corsHeaders(origin) });
      }
      const submissions = Array.isArray(body?.submissions)
        ? body.submissions
        : (body?.formData ? [body.formData] : []);
      const refs = [];
      for (const formData of submissions) {
        const result = await ctx.runMutation(api.websiteQuotes.submitWebsiteQuote, { formData });
        if (result && result.ok) {
          try {
            const mailOut = await sendQuoteEmails(formData, result);
            console.log("website-quote emails:", JSON.stringify(mailOut));
          } catch (emailError) {
            console.error("website-quote email send failed", String(emailError));
          }
          if (result.ref) refs.push(result.ref);
        } else {
          throw new Error((result && result.error) || "Quote submission failed.");
        }
      }
      return Response.json({ ok: true, ref: refs[0] || "", refs }, { status: 200, headers: corsHeaders(origin) });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: String(error?.message || "Quote submission failed."),
        },
        {
          status: 400,
          headers: corsHeaders(origin),
        }
      );
    }
  }),
});

http.route({
  path: "/website-contact",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }),
});

http.route({
  path: "/website-contact",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    try {
      const body = await request.json();
      if (body && body.website) {
        return Response.json({ ok: true }, { status: 200, headers: corsHeaders(origin) });
      }
      const human = await verifyTurnstile(body && body.turnstileToken, clientIp(request));
      if (!human) {
        return Response.json({ ok: false, error: "Verification failed. Please try again." }, { status: 400, headers: corsHeaders(origin) });
      }
      const formData = body?.formData || {};
      let mailOut = null;
      try {
        mailOut = await sendContactEmails(formData);
        console.log("website-contact emails:", JSON.stringify(mailOut));
      } catch (emailError) {
        console.error("website-contact email send failed", String(emailError));
      }
      const ok = !!(mailOut && mailOut.sent && mailOut.office && mailOut.office.ok);
      return Response.json(
        { ok, error: ok ? undefined : "Could not send your message right now." },
        { status: 200, headers: corsHeaders(origin) }
      );
    } catch (error) {
      return Response.json(
        { ok: false, error: String(error?.message || "Contact submission failed.") },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
  }),
});

http.route({
  path: "/public-booking",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }),
});

http.route({
  path: "/public-booking",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    const token = getTokenFromRequest(request);
    if (!token) {
      return Response.json(
        { status: "not_found" },
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    try {
      const result = await ctx.runMutation(api.bookings.openPublicLink, { token });
      return Response.json(result, {
        status: result?.status === "not_found" ? 404 : 200,
        headers: corsHeaders(origin),
      });
    } catch (error) {
      return Response.json(
        {
          status: "error",
          message: String(error?.message || "The booking form could not be loaded right now."),
        },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
  }),
});

http.route({
  path: "/public-booking",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    const token = getTokenFromRequest(request);
    if (!token) {
      return Response.json(
        { status: "not_found" },
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    try {
      const body = await request.json();
      const result = await ctx.runMutation(api.bookings.submitPublicForm, {
        token,
        baseUrl: String(body?.baseUrl || ""),
        clientIp: String(body?.clientIp || ""),
        formData: body?.formData || {},
      });
      return Response.json(result, {
        status: 200,
        headers: corsHeaders(origin),
      });
    } catch (error) {
      return Response.json(
        {
          status: "error",
          message: String(error?.message || "The booking form could not be saved right now."),
        },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
  }),
});

http.route({
  path: "/track-visit",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }),
});

http.route({
  path: "/track-visit",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin") || "*";
    try { await ctx.runMutation(api.websiteStats.recordVisit, {}); } catch (e) {}
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }),
});

// ---- Google Analytics OAuth callback (one-time connect flow) ----
function ga4Html(message, ok) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="margin:0;font-family:system-ui,sans-serif;background:#070f24;color:#eef3fb;display:flex;min-height:100vh;align-items:center;justify-content:center">` +
    `<div style="text-align:center;max-width:440px;padding:32px"><div style="font-size:44px;margin-bottom:10px">${ok ? "&#10003;" : "&#9888;"}</div>` +
    `<h2 style="margin:0 0 8px">${message}</h2>` +
    `<p style="color:#9db1d6">You can close this tab and return to the dashboard.</p></div></body>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

http.route({
  path: "/oauth/ga4/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return ga4Html("Google sign-in was cancelled.", false);
    if (!state || state !== process.env.GA4_OAUTH_STATE) return ga4Html("Security check failed (bad state).", false);
    if (!code) return ga4Html("Missing authorization code.", false);
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GA4_OAUTH_CLIENT_ID,
          client_secret: process.env.GA4_OAUTH_CLIENT_SECRET,
          redirect_uri: process.env.GA4_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const tok = await tokenRes.json();
      if (!tok.refresh_token) {
        return ga4Html("No refresh token returned - try disconnecting and reconnecting.", false);
      }
      // decode the id_token (if present) just to record which account connected
      let email = "";
      try {
        if (tok.id_token) {
          const payload = JSON.parse(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
          email = payload.email || "";
        }
      } catch { /* non-fatal */ }
      await ctx.runMutation(internal.ga4.storeRefreshToken, { refreshToken: tok.refresh_token, email });
      return ga4Html("Google Analytics connected", true);
    } catch (e) {
      return ga4Html("Connection failed: " + String(e.message || e), false);
    }
  }),
});

// ---- Server-health + backup ingest (from the on-VPS collector/backup crons) ----
// Secret-guarded: the collector sends `x-health-secret: $HEALTH_INGEST_SECRET`.
http.route({
  path: "/health/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = request.headers.get("x-health-secret") || "";
    if (!process.env.HEALTH_INGEST_SECRET || secret !== process.env.HEALTH_INGEST_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let body;
    try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
    await ctx.runMutation(internal.serverHealth.ingest, {
      ts: Number(body.ts) || Date.now(),
      diskPct: Number(body.diskPct) || 0,
      memPct: Number(body.memPct) || 0,
      overallOk: Boolean(body.overallOk),
      payload: JSON.stringify(body),
    });
    return new Response("ok", { status: 200 });
  }),
});

http.route({
  path: "/backup/report",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = request.headers.get("x-health-secret") || "";
    if (!process.env.HEALTH_INGEST_SECRET || secret !== process.env.HEALTH_INGEST_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let body;
    try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
    await ctx.runMutation(internal.serverHealth.recordBackup, {
      ts: Number(body.ts) || Date.now(),
      ok: Boolean(body.ok),
      target: String(body.target || "unknown"),
      sizeBytes: Number(body.sizeBytes) || 0,
      label: String(body.label || ""),
      detail: String(body.detail || ""),
      durationMs: Number(body.durationMs) || 0,
    });
    return new Response("ok", { status: 200 });
  }),
});

export default http;

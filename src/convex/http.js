import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
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

export default http;

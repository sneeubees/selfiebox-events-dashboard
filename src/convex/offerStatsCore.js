// Year-end special landing pages: requests + conversions per offer code.
// The logic behind websiteStats.js:getOfferStats, kept free of Convex imports
// so offer-stats.test.mjs can run it (and the original version of it) with
// plain node against an in-memory table.
//
// Why it no longer scans whole workspace years (2026-10-26, slowness fix):
// the original query collected every event of the request year and the next
// one (~2,900 docs, even for "last 7 days") plus one sequential eventBookings
// lookup per legacy website event, and hit the 15 s limit on busy days.
// Now it reads only the events CREATED since the start of the range and gets
// the bookings it needs with one range read. The result is the same:
//  - Every counted event has websiteOrigin, which only websiteQuotes.js:
//    submitWebsiteQuote sets on insert (the old backfill only patched that
//    flag onto events the quote form had created). That mutation sets
//    createdAt = Date.now() in the same transaction that assigns
//    _creationTime, and no board code changes events.createdAt afterwards.
//    (The one exception is bookingStats.js:ingestSyncBundle, a CLI-only
//    live -> staging copy tool that is never run against live.) So
//    _creationTime >= createdAt - OFFER_SCAN_SLACK_MS, and an event whose
//    createdAt is >= from always lies in the _creationTime >= from - slack
//    range. (When createdAt is missing the old code used _creationTime
//    itself, which is trivially in range.) Restoring a backup either keeps
//    _creationTime or moves it later, never earlier.
//  - The scan has no upper bound, because _creationTime may be later than
//    createdAt.
//  - The old per-year loop only saw events whose workspaceYear equals one of
//    the scanned years, so the same year check is applied in code.
//  - Bookings found by the range read are the same rows the old
//    by_event .unique() lookup returned. Each event has at most one booking:
//    every insert path either creates the booking with a brand-new event or
//    checks for an existing one first. An eventId seen twice in the range
//    read, or not seen at all, falls back to the original lookup.
//  - Counting is order-independent.

// Slack between createdAt and _creationTime. They are set in the same
// transaction, so in practice they differ by milliseconds.
export const OFFER_SCAN_SLACK_MS = 24 * 3600 * 1000;
// A website quote's booking is inserted in the same mutation as its event,
// so its _creationTime is within a few ms of the event's. A booking outside
// this window is still found by the per-event fallback lookup.
export const OFFER_BOOKING_SLACK_MS = 3600 * 1000;

export function sastBounds(startDate, endDate) {
  const parse = (d, end) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "").trim());
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 2 * 3600 * 1000; // 00:00 SAST
    return end ? ms + 24 * 3600 * 1000 - 1 : ms;
  };
  return { from: parse(startDate, false), to: parse(endDate, true) };
}

export function offerCodeFromNotes(text) {
  return (String(text || "").match(/\[OFFER:\s*([A-Z0-9_]+)\]/) || [])[1] || "";
}

// The original loop: `for (year = startYear; year <= endYear + 1; year++)`
// with one by_workspace_year .eq(year) query each. Event dates can fall in the
// next calendar year, hence the + 1.
export function offerScanYears(startDate, endDate) {
  return { firstYear: Number(startDate.slice(0, 4)), lastYear: Number(endDate.slice(0, 4)) + 1 };
}

// True for a website quote request that the original query counted: it was in
// one of the scanned workspace years and created within [from, to].
export function isOfferRequestCandidate(event, scan) {
  const year = event.workspaceYear;
  if (!Number.isInteger(year) || year < scan.firstYear || year > scan.lastYear) return false;
  if (!event.websiteOrigin) return false;
  const created = Number.isFinite(event.createdAt) ? event.createdAt : event._creationTime;
  return !(created < scan.from || created > scan.to);
}

// eventId -> booking from one range read. Ids seen twice are left out so the
// caller's .unique() fallback handles them exactly as before.
export function indexBookingsByEvent(bookings) {
  const byEvent = new Map();
  const repeated = new Set();
  for (const booking of bookings) {
    const key = String(booking.eventId);
    if (byEvent.has(key)) repeated.add(key);
    else byEvent.set(key, booking);
  }
  for (const key of repeated) byEvent.delete(key);
  return byEvent;
}

export function emptyOfferCounts(pages) {
  return Object.fromEntries(pages.map((p) => [p.code, { requests: 0, converted: 0, completed: 0 }]));
}

export function tallyOfferRequest(counts, event, code) {
  if (!code || !counts[code]) return;
  counts[code].requests += 1;
  const timeline = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
  const status = String(event.status || "").trim().toLowerCase();
  const reachedInProgress = status === "in progress" || status === "event completed"
    || timeline.some((e) => String(e.status || "").trim().toLowerCase() === "in progress");
  if (reachedInProgress) counts[code].converted += 1;
  if (status === "event completed") counts[code].completed += 1;
}

export function offerStatsResult(pages, counts, range) {
  return {
    range,
    pages: pages.map((p) => ({ ...p, ...counts[p.code], conversionPct: counts[p.code].requests ? Math.round((100 * counts[p.code].converted) / counts[p.code].requests) : null })),
  };
}

// db = ctx.db. Reads are sequential on purpose: self-hosted Convex crashes on
// Promise.all over ctx.db calls.
export async function computeOfferStats(db, args, pages) {
  const { from, to } = sastBounds(args.startDate, args.endDate);
  if (from === null || to === null) return { pages: [], range: args };
  const scan = { ...offerScanYears(args.startDate, args.endDate), from, to };
  const counts = emptyOfferCounts(pages);
  const events = await db
    .query("events")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", from - OFFER_SCAN_SLACK_MS))
    .collect();
  const requests = events.filter((event) => isOfferRequestCandidate(event, scan));
  // Requests from before the code was stored on the event: read the booking notes.
  const needNotes = requests.filter((event) => !event.websiteOffer);
  let bookingByEvent = new Map();
  if (needNotes.length) {
    let first = Infinity;
    let last = -Infinity;
    for (const event of needNotes) {
      first = Math.min(first, event._creationTime);
      last = Math.max(last, event._creationTime);
    }
    const bookings = await db
      .query("eventBookings")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", first - OFFER_BOOKING_SLACK_MS).lte("_creationTime", last + OFFER_BOOKING_SLACK_MS))
      .collect();
    bookingByEvent = indexBookingsByEvent(bookings);
  }
  for (const event of requests) {
    let code = event.websiteOffer || "";
    if (!code) {
      const key = String(event._id);
      const booking = bookingByEvent.has(key)
        ? bookingByEvent.get(key)
        : await db
          .query("eventBookings")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .unique();
      code = offerCodeFromNotes(booking?.formData?.notes);
    }
    tallyOfferRequest(counts, event, code);
  }
  return offerStatsResult(pages, counts, args);
}

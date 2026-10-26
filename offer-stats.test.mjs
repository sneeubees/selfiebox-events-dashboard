// node --test offer-stats.test.mjs
// Checks that websiteStats.getOfferStats (now src/convex/offerStatsCore.js:
// computeOfferStats) returns exactly what the original per-workspace-year
// version returned, on an in-memory copy of the events/eventBookings tables
// that mimics Convex index reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/convex/offerStatsCore.js', import.meta.url), 'utf8');
const core = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { computeOfferStats, OFFER_SCAN_SLACK_MS } = core;

const OFFER_PAGES = [
  { code: 'YEAR_END_360_2026_LED_STANCHIONS', path: '/year-end-360/', label: 'Year-End 360' },
  { code: 'YEAR_END_2026_EXTRA_HOUR', path: '/year-end-photo-booths/', label: 'Year-End Photo Booths' },
];

// ---- The handler body as it was at 64230c6 (verbatim apart from ctx.db -> db). ----
function legacySastBounds(startDate, endDate) {
  const parse = (d, end) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').trim());
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 2 * 3600 * 1000; // 00:00 SAST
    return end ? ms + 24 * 3600 * 1000 - 1 : ms;
  };
  return { from: parse(startDate, false), to: parse(endDate, true) };
}
function legacyOfferCodeFromNotes(text) {
  return (String(text || '').match(/\[OFFER:\s*([A-Z0-9_]+)\]/) || [])[1] || '';
}
async function legacyGetOfferStats(db, args) {
  const { from, to } = legacySastBounds(args.startDate, args.endDate);
  if (from === null || to === null) return { pages: [], range: args };
  const y0 = Number(args.startDate.slice(0, 4));
  const y1 = Number(args.endDate.slice(0, 4)) + 1;
  const counts = Object.fromEntries(OFFER_PAGES.map((p) => [p.code, { requests: 0, converted: 0, completed: 0 }]));
  for (let year = y0; year <= y1; year += 1) {
    const events = await db
      .query('events')
      .withIndex('by_workspace_year', (q) => q.eq('workspaceYear', year))
      .collect();
    for (const event of events) {
      if (!event.websiteOrigin) continue;
      const created = Number.isFinite(event.createdAt) ? event.createdAt : event._creationTime;
      if (created < from || created > to) continue;
      let code = event.websiteOffer || '';
      if (!code) {
        const booking = await db
          .query('eventBookings')
          .withIndex('by_event', (q) => q.eq('eventId', event._id))
          .unique();
        code = legacyOfferCodeFromNotes(booking?.formData?.notes);
      }
      if (!code || !counts[code]) continue;
      counts[code].requests += 1;
      const timeline = Array.isArray(event.statusTimeline) ? event.statusTimeline : [];
      const status = String(event.status || '').trim().toLowerCase();
      const reachedInProgress = status === 'in progress' || status === 'event completed'
        || timeline.some((e) => String(e.status || '').trim().toLowerCase() === 'in progress');
      if (reachedInProgress) counts[code].converted += 1;
      if (status === 'event completed') counts[code].completed += 1;
    }
  }
  return {
    range: args,
    pages: OFFER_PAGES.map((p) => ({ ...p, ...counts[p.code], conversionPct: counts[p.code].requests ? Math.round((100 * counts[p.code].converted) / counts[p.code].requests) : null })),
  };
}

// ---- Minimal in-memory ctx.db: index reads return rows in index order. ----
const INDEX_FIELDS = { by_creation_time: [], by_workspace_year: ['workspaceYear'], by_event: ['eventId'] };
function makeDb(tables) {
  const stats = { reads: 0, docs: 0 };
  const db = {
    stats,
    query(table) {
      return {
        withIndex(indexName, build) {
          const fields = [...INDEX_FIELDS[indexName], '_creationTime'];
          const conditions = [];
          const q = {};
          for (const op of ['eq', 'gt', 'gte', 'lt', 'lte']) {
            q[op] = (field, value) => { conditions.push({ op, field, value }); return q; };
          }
          build(q);
          for (const { field } of conditions) assert.ok(fields.includes(field), `${field} is not in ${indexName}`);
          const matches = (doc) => conditions.every(({ op, field, value }) => {
            const actual = doc[field];
            if (op === 'eq') return actual === value || (actual !== actual && value !== value);
            if (typeof actual !== 'number') return false;
            return op === 'gt' ? actual > value : op === 'gte' ? actual >= value : op === 'lt' ? actual < value : actual <= value;
          });
          const run = () => {
            stats.reads += 1;
            const rows = (tables[table] || []).filter(matches).sort((a, b) => {
              for (const field of fields) {
                if (a[field] < b[field]) return -1;
                if (a[field] > b[field]) return 1;
              }
              return 0;
            });
            stats.docs += rows.length;
            return rows;
          };
          return {
            collect: async () => run(),
            unique: async () => {
              const rows = run();
              if (rows.length > 1) throw new Error('unique() query returned more than one result');
              return rows[0] ?? null;
            },
          };
        },
      };
    },
  };
  return db;
}

async function bothResults(tables, args) {
  const legacyDb = makeDb(tables);
  const newDb = makeDb(tables);
  const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error: error.message }));
  const legacy = await settle(legacyGetOfferStats(legacyDb, args));
  const current = await settle(computeOfferStats(newDb, args, OFFER_PAGES));
  return { legacy, current, legacyStats: legacyDb.stats, newStats: newDb.stats };
}

// ---- Random tables shaped like the real data (and some that are not). ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 24 * 3600 * 1000;
const CODES = [undefined, '', 'YEAR_END_360_2026_LED_STANCHIONS', 'YEAR_END_2026_EXTRA_HOUR', 'SOME_OTHER_OFFER'];
const STATUSES = [undefined, '', 'Web Request', 'Quote Sent', 'In Progress', ' in progress ', 'Event Completed', 'EVENT COMPLETED', 'Cancelled'];
const NOTES = [undefined, '', 'Enquiry Ref: SB-1\n\nMessage: [OFFER: YEAR_END_360_2026_LED_STANCHIONS] Hi', '[OFFER:YEAR_END_2026_EXTRA_HOUR]', '[OFFER: UNKNOWN_CODE] x', 'no offer here'];

function randomTables(seed, { events: eventCount = 300, start = Date.UTC(2025, 9, 1), end = Date.UTC(2026, 9, 26), sameMutationBookings = false } = {}) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const events = [];
  const eventBookings = [];
  let t = start;
  const step = (end - start) / eventCount;
  for (let i = 0; i < eventCount; i += 1) {
    t += random() * step * 2 + 0.001;
    const creation = t;
    const kind = random();
    // createdAt is Date.now() of the inserting mutation: within ms of
    // _creationTime. Some rows were restored/copied later (older createdAt,
    // later _creationTime); a few have no usable createdAt.
    const createdAt = kind < 0.6 ? Math.floor(creation) - Math.floor(random() * 50)
      : kind < 0.75 ? creation + random() * 5000
        : kind < 0.85 ? creation - random() * 60 * DAY
          : kind < 0.92 ? creation + random() * (OFFER_SCAN_SLACK_MS - 1)
            : pick([undefined, NaN, Infinity]);
    const yearRoll = random();
    const workspaceYear = yearRoll < 0.03 ? pick([2026.5, NaN, 0, 202]) : pick([2025, 2026, 2026, 2026, 2027, 2028]);
    const timeline = random() < 0.4 ? [{ status: pick(['Quote Sent', 'In Progress', ' IN PROGRESS', 'Cancelled']), at: creation + DAY }] : random() < 0.5 ? undefined : [];
    const event = {
      _id: `ev${seed}_${i}`,
      _creationTime: creation,
      workspaceYear,
      websiteOrigin: random() < 0.6 ? true : pick([undefined, false]),
      websiteOffer: pick(CODES),
      status: pick(STATUSES),
      statusTimeline: timeline,
      createdAt,
    };
    events.push(event);
    // sameMutationBookings: like live, where the quote form always inserts
    // the booking together with the website event.
    const bookingRoll = sameMutationBookings && event.websiteOrigin ? 0 : random();
    if (bookingRoll < 0.6) {
      // Inserted by the same mutation, right after the event.
      eventBookings.push({ _id: `bk${seed}_${i}`, _creationTime: creation + 0.0001, eventId: event._id, formData: random() < 0.95 ? { notes: pick(NOTES) } : undefined });
    } else if (bookingRoll < 0.75) {
      // Booking link generated later from the drawer (outside the read window).
      eventBookings.push({ _id: `bk${seed}_${i}`, _creationTime: creation + (1 + random() * 40) * DAY, eventId: event._id, formData: { notes: pick(NOTES) } });
    }
  }
  return { events, eventBookings };
}

const zaDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

test('same result as the original query on random tables and ranges', async () => {
  let compared = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const tables = randomTables(seed);
    const random = rng(seed * 7919);
    const now = Date.UTC(2026, 9, 26, 10);
    const ranges = [
      { startDate: zaDay(now), endDate: zaDay(now) },
      { startDate: zaDay(now - 6 * DAY), endDate: zaDay(now) },
      { startDate: zaDay(now - 29 * DAY), endDate: zaDay(now) },
      { startDate: '2026-07-02', endDate: zaDay(now) },
    ];
    for (let r = 0; r < 6; r += 1) {
      const a = Date.UTC(2025, 8, 1) + random() * 450 * DAY;
      const b = a + random() * 200 * DAY;
      ranges.push({ startDate: zaDay(a), endDate: zaDay(b) });
    }
    for (const args of ranges) {
      const { legacy, current } = await bothResults(tables, args);
      assert.deepEqual(current, legacy, `seed ${seed} ${JSON.stringify(args)}`);
      compared += 1;
    }
  }
  assert.equal(compared, 600);
});

test('same result for odd arguments', async () => {
  const tables = randomTables(99);
  const oddRanges = [
    { startDate: '', endDate: '' },
    { startDate: 'not a date', endDate: '2026-10-26' },
    { startDate: '2026-10-26', endDate: '2026-10-01' }, // end before start
    { startDate: '2028-01-01', endDate: '2026-01-01' }, // start year after end year + 1: no years scanned
    { startDate: ' 2026-07-02', endDate: '2026-10-26' }, // leading space: old code read the year as 202
    { startDate: '2026-07-02 ', endDate: ' 2026-10-26' },
    { startDate: '2025-10-01', endDate: '2025-10-01' },
  ];
  for (const args of oddRanges) {
    const { legacy, current } = await bothResults(tables, args);
    assert.deepEqual(current, legacy, JSON.stringify(args));
  }
});

test('edge rows: slack, years outside the scan, late and duplicate bookings', async () => {
  const from = Date.UTC(2026, 9, 1) - 2 * 3600 * 1000; // 2026-10-01 00:00 SAST
  const base = { websiteOrigin: true, status: 'In Progress', statusTimeline: [] };
  const events = [
    // createdAt inside the range, _creationTime almost a full slack earlier.
    { ...base, _id: 'a', _creationTime: from - OFFER_SCAN_SLACK_MS + 1000, createdAt: from + 500, workspaceYear: 2026, websiteOffer: 'YEAR_END_2026_EXTRA_HOUR' },
    // createdAt weeks before _creationTime (restored row): counted by createdAt.
    { ...base, _id: 'b', _creationTime: from + 25 * DAY, createdAt: from + 3600 * 1000, workspaceYear: 2026, websiteOffer: 'YEAR_END_2026_EXTRA_HOUR' },
    { ...base, _id: 'c', _creationTime: from + 6 * DAY, createdAt: from + 6 * DAY, workspaceYear: 2026, websiteOffer: 'YEAR_END_2026_EXTRA_HOUR' },
    // Created in range but on a board the old loop never read.
    { ...base, _id: 'd', _creationTime: from + DAY, createdAt: from + DAY, workspaceYear: 2028, websiteOffer: 'YEAR_END_2026_EXTRA_HOUR' },
    { ...base, _id: 'e', _creationTime: from + DAY + 1, createdAt: from + DAY + 1, workspaceYear: 2026.5, websiteOffer: 'YEAR_END_2026_EXTRA_HOUR' },
    // Legacy rows without websiteOffer: booking in the same mutation / generated weeks later / none.
    { ...base, _id: 'f', _creationTime: from + 2 * DAY, createdAt: from + 2 * DAY, workspaceYear: 2027 },
    { ...base, _id: 'g', _creationTime: from + 3 * DAY, createdAt: from + 3 * DAY, workspaceYear: 2026, status: 'Event Completed' },
    { ...base, _id: 'h', _creationTime: from + 4 * DAY, createdAt: from + 4 * DAY, workspaceYear: 2026 },
  ];
  const eventBookings = [
    { _id: 'bf', _creationTime: from + 2 * DAY + 0.01, eventId: 'f', formData: { notes: '[OFFER: YEAR_END_360_2026_LED_STANCHIONS]' } },
    { _id: 'bg', _creationTime: from + 20 * DAY, eventId: 'g', formData: { notes: 'Message: [OFFER: YEAR_END_360_2026_LED_STANCHIONS] please' } },
  ];
  const args = { startDate: '2026-10-01', endDate: '2026-10-31' };
  const { legacy, current, newStats } = await bothResults({ events, eventBookings }, args);
  assert.deepEqual(current, legacy);
  assert.deepEqual(current.value.pages.map((p) => [p.requests, p.converted, p.completed]), [[2, 2, 1], [3, 3, 0]]);
  // events range + bookings range + per-event fallback for g and h only.
  assert.equal(newStats.reads, 4);

  // Two bookings for one event (never created by the app): both versions throw.
  const duplicated = { events, eventBookings: [...eventBookings, { _id: 'bf2', _creationTime: from + 2 * DAY + 0.02, eventId: 'f', formData: { notes: '' } }] };
  const dup = await bothResults(duplicated, args);
  assert.ok(dup.legacy.error && dup.current.error);
  assert.equal(dup.current.error, dup.legacy.error);
});

test('reads far fewer documents on a board-sized table', async () => {
  // ~2,900 rows on the 2026 + 2027 boards, created through 2026, like live.
  const tables = randomTables(2026, { events: 3200, start: Date.UTC(2025, 11, 1), end: Date.UTC(2026, 9, 26), sameMutationBookings: true });
  const now = Date.UTC(2026, 9, 26, 10);
  for (const [label, startDate] of [['last 7 days', zaDay(now - 6 * DAY)], ['since launch', '2026-07-02']]) {
    const { legacy, current, legacyStats, newStats } = await bothResults(tables, { startDate, endDate: zaDay(now) });
    assert.deepEqual(current, legacy);
    assert.ok(newStats.docs < legacyStats.docs, label);
    assert.equal(newStats.reads, 2, label); // one events range + one bookings range, no per-row lookups
    console.log(`${label}: original ${legacyStats.reads} index reads / ${legacyStats.docs} docs, now ${newStats.reads} / ${newStats.docs}`);
  }
});

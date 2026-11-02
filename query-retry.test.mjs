// node --test query-retry.test.mjs
// src/queryRetry.js: when a failed board query is tried again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/queryRetry.js', import.meta.url), 'utf8');
const { createRetryChannel, getRetryChannel, retryDelayMs, NO_RETRY_CHANNEL, NOT_RETRYING, RETRY_DROP_MS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// Manual clock: advance(ms) runs due timers in order.
function fakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer: (callback, ms) => { const id = nextId++; timers.set(id, { at: time + ms, callback }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = end;
    },
    pending: () => timers.size,
    now: () => time,
  };
}

// A channel with one listening hook; `drops` records when each retry happened.
function setup() {
  const clock = fakeClock();
  const channel = createRetryChannel(clock);
  const drops = [];
  let wasDropped = false;
  const stop = channel.subscribe(() => {
    const { dropped } = channel.getSnapshot();
    if (dropped && !wasDropped) drops.push(clock.now());
    wasDropped = dropped;
  });
  return { clock, channel, drops, stop };
}

test('the retry schedule is 2 s, 5 s, 10 s, 30 s, then every 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(retryDelayMs), [2000, 5000, 10000, 30000, 30000, 30000, 30000]);
});

test('nothing happens until a failure is reported', () => {
  const { clock, channel } = setup();
  clock.advance(120000);
  assert.equal(channel.getSnapshot(), NOT_RETRYING);
  assert.equal(clock.pending(), 0);
});

test('retries follow the schedule for as long as the failure lasts', () => {
  const { clock, channel, drops } = setup();
  channel.reportFailure();
  clock.advance(200000);
  const gaps = drops.map((time, index) => time - (index ? drops[index - 1] + RETRY_DROP_MS : 0));
  assert.deepEqual(gaps.slice(0, 6), [2000, 5000, 10000, 30000, 30000, 30000]);
  assert.ok(drops.length >= 6);
  assert.equal(channel.getSnapshot().retries, drops.length);
});

test('a retry drops the query, then adds it back after the short gap', () => {
  const { clock, channel } = setup();
  channel.reportFailure();
  assert.equal(channel.getSnapshot().dropped, false);
  clock.advance(2000);
  assert.equal(channel.getSnapshot().dropped, true);
  clock.advance(RETRY_DROP_MS - 1);
  assert.equal(channel.getSnapshot().dropped, true);
  clock.advance(1);
  assert.equal(channel.getSnapshot().dropped, false);
  assert.equal(channel.getSnapshot().failing, true);
});

test('every hook, and the cached error, can report the same failure without stacking retries', () => {
  const { clock, channel, drops } = setup();
  channel.reportFailure();
  channel.reportFailure();
  clock.advance(1000);
  channel.reportFailure();
  assert.equal(clock.pending(), 1);
  clock.advance(1000);
  channel.reportFailure();
  assert.equal(clock.pending(), 1);
  assert.deepEqual(drops, [2000]);
});

test('success stops the retries and the next failure starts again at 2 s', () => {
  const { clock, channel, drops } = setup();
  channel.reportFailure();
  clock.advance(2000 + RETRY_DROP_MS + 5000 + RETRY_DROP_MS);
  channel.reportSuccess();
  assert.equal(channel.getSnapshot(), NOT_RETRYING);
  assert.equal(clock.pending(), 0);
  const before = drops.length;
  clock.advance(60000);
  assert.equal(drops.length, before);
  channel.reportFailure();
  clock.advance(2000);
  assert.equal(drops.length, before + 1);
});

test('success during the drop gap adds the query back straight away', () => {
  const { clock, channel } = setup();
  channel.reportFailure();
  clock.advance(2000);
  channel.reportSuccess();
  assert.equal(channel.getSnapshot().dropped, false);
  assert.equal(clock.pending(), 0);
});

test('success with no failure going on changes nothing, so a working board never re-renders for it', () => {
  const clock = fakeClock();
  const channel = createRetryChannel(clock);
  let notified = 0;
  channel.subscribe(() => { notified += 1; });
  channel.reportSuccess();
  assert.equal(notified, 0);
});

test('timers stop when the last hook leaves, not while another hook still shows the query', () => {
  const { clock, channel, stop } = setup();
  const stopSecond = channel.subscribe(() => {});
  channel.reportFailure();
  stop();
  assert.equal(clock.pending(), 1);
  stopSecond();
  assert.equal(clock.pending(), 0);
  assert.equal(channel.getSnapshot(), NOT_RETRYING);
});

test('leaving during the drop gap cannot strand the query dropped', () => {
  const { clock, channel, stop } = setup();
  channel.reportFailure();
  clock.advance(2000);
  stop();
  assert.equal(clock.pending(), 0);
  assert.equal(channel.getSnapshot().dropped, false);
});

test('a hook joining a channel mid-failure shares its retries', () => {
  const { clock, channel, drops } = setup();
  channel.reportFailure();
  clock.advance(1000);
  const heard = [];
  channel.subscribe(() => heard.push(channel.getSnapshot().dropped));
  clock.advance(1000);
  assert.deepEqual(drops, [2000]);
  assert.deepEqual(heard, [true]);
});

test('hooks on the same query get the same channel, other args get their own', () => {
  const key = 'events:list|{"workspaceYear":2026}';
  assert.equal(getRetryChannel(key), getRetryChannel(key));
  assert.notEqual(getRetryChannel(key), getRetryChannel('events:list|{"workspaceYear":2025}'));
});

test('a skipped query can never start retrying', () => {
  NO_RETRY_CHANNEL.reportFailure();
  assert.equal(NO_RETRY_CHANNEL.getSnapshot(), NOT_RETRYING);
});

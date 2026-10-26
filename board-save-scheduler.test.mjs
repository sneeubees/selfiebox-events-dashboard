// node --test board-save-scheduler.test.mjs
// src/boardSaveScheduler.js: when board row edits are sent to Convex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/boardSaveScheduler.js', import.meta.url), 'utf8');
const { createBoardSaveScheduler, nextBoardSaveTiming, TYPING_SAVE, BOARD_SAVE_DELAY_MS, BOARD_TYPING_SAVE_DELAY_MS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// Manual clock: advance(ms) runs due timers in order.
function fakeClock() {
  let time = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
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
  };
}

function setup() {
  const clock = fakeClock();
  const scheduler = createBoardSaveScheduler(clock);
  const sent = [];
  const save = (id, value) => scheduler.schedule(id, () => sent.push([id, value]), undefined);
  const type = (id, value) => scheduler.schedule(id, () => sent.push([id, value]), TYPING_SAVE);
  return { clock, scheduler, sent, save, type };
}

test('timing rule', () => {
  assert.deepEqual(nextBoardSaveTiming(undefined, 0, false), { deadline: BOARD_SAVE_DELAY_MS, typing: false });
  assert.deepEqual(nextBoardSaveTiming(undefined, 0, true), { deadline: BOARD_TYPING_SAVE_DELAY_MS, typing: true });
  // Typing pushes its own idle deadline out...
  assert.deepEqual(nextBoardSaveTiming({ deadline: 2000, typing: true }, 1500, true), { deadline: 3500, typing: true });
  // ...but never a pick/tick that is already waiting.
  assert.deepEqual(nextBoardSaveTiming({ deadline: 250, typing: false }, 100, true), { deadline: 250, typing: false });
  // A pick after typing goes out at the normal 250 ms.
  assert.deepEqual(nextBoardSaveTiming({ deadline: 3500, typing: true }, 1600, false), { deadline: 1850, typing: false });
});

test('non-typed edits still save after 250 ms, debounced as before', () => {
  const { clock, sent, save } = setup();
  save('a', 1);
  clock.advance(200);
  save('a', 2);
  clock.advance(249);
  assert.deepEqual(sent, []);
  clock.advance(1);
  assert.deepEqual(sent, [['a', 2]]);
});

test('typing saves once, 2 s after the last keystroke, with the final value', () => {
  const { clock, sent, type } = setup();
  for (const [i, value] of ['7', '73', '737', '7370'].entries()) {
    if (i) clock.advance(400);
    type('a', value);
  }
  clock.advance(1999);
  assert.deepEqual(sent, []);
  clock.advance(1);
  assert.deepEqual(sent, [['a', '7370']]);
  clock.advance(10_000);
  assert.equal(sent.length, 1);
});

test('leaving the cell (flush) sends the waiting save at once, only once', () => {
  const { clock, scheduler, sent, type } = setup();
  type('a', '12:00');
  assert.equal(scheduler.flush('a'), true);
  assert.deepEqual(sent, [['a', '12:00']]);
  assert.equal(scheduler.flush('a'), false); // a second blur sends nothing
  clock.advance(5000);
  assert.equal(sent.length, 1);
  assert.equal(clock.pending(), 0);
});

test('a pick on the same row is not held back by typing that follows', () => {
  const { clock, sent, save, type } = setup();
  save('a', 'status');
  clock.advance(100);
  type('a', 'status+typed');
  clock.advance(150); // 250 ms after the pick
  assert.deepEqual(sent, [['a', 'status+typed']]);
  type('a', 'more');
  clock.advance(1999);
  assert.equal(sent.length, 1);
  clock.advance(1);
  assert.deepEqual(sent.at(-1), ['a', 'more']);
});

test('typing then a pick: one save at 250 ms with both', () => {
  const { clock, sent, save, type } = setup();
  type('a', 'typed');
  clock.advance(500);
  save('a', 'typed+pick');
  clock.advance(250);
  assert.deepEqual(sent, [['a', 'typed+pick']]);
});

test('flushAll sends every row (tab hidden / page closed), even if one save throws', () => {
  const { scheduler, sent, type } = setup();
  type('a', 1);
  scheduler.schedule('b', () => { throw new Error('boom'); }, TYPING_SAVE);
  type('c', 3);
  const originalError = console.error;
  console.error = () => {};
  try {
    scheduler.flushAll();
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(sent, [['a', 1], ['c', 3]]);
  assert.equal(scheduler.isPending('a') || scheduler.isPending('b') || scheduler.isPending('c'), false);
});

test('cancel (row deleted) drops the waiting save', () => {
  const { clock, scheduler, sent, type } = setup();
  type('a', 'x');
  scheduler.cancel('a');
  clock.advance(5000);
  scheduler.flushAll();
  assert.deepEqual(sent, []);
});

test('rows are independent', () => {
  const { clock, scheduler, sent, save, type } = setup();
  type('a', 'typing');
  save('b', 'pick');
  clock.advance(250);
  assert.deepEqual(sent, [['b', 'pick']]);
  scheduler.flush('b');
  assert.equal(scheduler.isPending('a'), true);
  clock.advance(1750);
  assert.deepEqual(sent, [['b', 'pick'], ['a', 'typing']]);
});

// When a board row's local edit is sent to Convex (events.upsert).
//
// Every save makes every colleague's open board re-run its year query, so
// free typing in a board cell no longer saves on each 250 ms pause (one typed
// price used to become 3-5 writes). Instead:
// - Typing (TYPING_SAVE): saved when the cell is left (blur) or Enter is
//   pressed (the caller calls flush), or 2 s after the last keystroke if the
//   cell stays focused, and flushAll() when the tab is hidden or the page
//   goes away. The board shows the typed value at once; only the save waits.
// - Everything else (picks, ticks, dates, new rows, retries): 250 ms, as
//   before. A save like that which is already waiting keeps its deadline even
//   if typing follows on the same row, so typing never delays it.
// One pending save per row; scheduling again replaces it with the newer one.

export const BOARD_SAVE_DELAY_MS = 250;
export const BOARD_TYPING_SAVE_DELAY_MS = 2000;
export const TYPING_SAVE = Object.freeze({ typing: true });

// pending: the save already waiting for this row ({ deadline, typing }) or
// undefined. Returns when the replacing save should run.
export function nextBoardSaveTiming(pending, now, typing) {
  if (!typing) return { deadline: now + BOARD_SAVE_DELAY_MS, typing: false };
  if (pending && !pending.typing) return { deadline: pending.deadline, typing: false };
  return { deadline: now + BOARD_TYPING_SAVE_DELAY_MS, typing: true };
}

export function createBoardSaveScheduler({
  setTimer = (callback, ms) => window.setTimeout(callback, ms),
  clearTimer = (timer) => window.clearTimeout(timer),
  now = () => Date.now(),
} = {}) {
  const pending = new Map();

  const run = (id) => {
    const entry = pending.get(id);
    if (!entry) return false;
    clearTimer(entry.timer);
    pending.delete(id);
    try {
      entry.save();
    } catch (error) {
      // Keep going: flushAll() must still send the other rows' saves.
      console.error('Failed to send board save', error);
    }
    return true;
  };

  return {
    // save: the newest save for this row (it captures the row's latest state).
    schedule(id, save, options) {
      const typing = Boolean(options && options.typing);
      const previous = pending.get(id);
      if (previous) clearTimer(previous.timer);
      const at = now();
      const timing = nextBoardSaveTiming(previous, at, typing);
      const entry = { ...timing, save, timer: null };
      entry.timer = setTimer(() => {
        if (pending.get(id) === entry) run(id);
      }, Math.max(0, timing.deadline - at));
      pending.set(id, entry);
    },
    // Send this row's waiting save now. Returns false when nothing was waiting.
    flush(id) {
      return run(id);
    },
    flushAll() {
      [...pending.keys()].forEach(run);
    },
    // Drop a waiting save without sending it (the row is being deleted).
    cancel(id) {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimer(entry.timer);
      pending.delete(id);
    },
    isPending(id) {
      return pending.has(id);
    },
  };
}

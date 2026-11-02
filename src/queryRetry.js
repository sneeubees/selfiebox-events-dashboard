// When a failed board query is tried again (see useResilientQuery.js). Kept away
// from React and Convex so the timing can be tested with a fake clock.
//
// There is one channel per query + args, shared by every hook showing that
// query, because Convex shares the server subscription too: the board and a
// report on the same year are one subscription with two subscribers. Dropping
// only one of them sends nothing to the server, so a retry has to make them all
// let go at the same moment.

// Wait this long before each retry. The last delay repeats until the query
// works again.
export const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

// How long a retry keeps the query unsubscribed. Every hook on the channel drops
// in the same commit (useSyncExternalStore renders synchronously, before any
// timer can run), so this only has to outlast that. Nothing shows during it: the
// hook keeps returning what it had.
export const RETRY_DROP_MS = 250;

export const NOT_RETRYING = Object.freeze({ failing: false, dropped: false, retries: 0 });

export function retryDelayMs(retriesDone) {
  return RETRY_DELAYS_MS[Math.min(retriesDone, RETRY_DELAYS_MS.length - 1)];
}

export function createRetryChannel({
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  const listeners = new Set();
  let state = NOT_RETRYING;
  let timer = null;

  const publish = (nextState) => {
    state = nextState;
    listeners.forEach((listener) => listener());
  };

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const waitForNextRetry = () => {
    timer = setTimer(() => {
      timer = setTimer(() => {
        timer = null;
        publish({ ...state, dropped: false });
        waitForNextRetry();
      }, RETRY_DROP_MS);
      publish({ ...state, dropped: true, retries: state.retries + 1 });
    }, retryDelayMs(state.retries));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // Nobody is showing this query any more (unmounted, skipped, or the
        // year changed), so there is nothing left to retry for.
        if (listeners.size === 0) {
          stopTimer();
          state = NOT_RETRYING;
        }
      };
    },
    getSnapshot: () => state,
    // Safe to call from every hook on the channel, and again for the old error
    // Convex keeps showing until its next server message: only the first call
    // of a failure starts the retries.
    reportFailure() {
      if (state.failing) return;
      publish({ failing: true, dropped: false, retries: 0 });
      waitForNextRetry();
    },
    reportSuccess() {
      if (!state.failing) return;
      stopTimer();
      publish(NOT_RETRYING);
    },
  };
}

// What a skipped query uses: the same shape, and it never retries.
export const NO_RETRY_CHANNEL = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => NOT_RETRYING,
  reportFailure() {},
  reportSuccess() {},
});

// Channels are never removed: a hook can hold on to one while its effects are
// re-run, so a replacement here could split hooks on the same query. Each is only
// a few small fields, one per board year opened.
const channels = new Map();

export function getRetryChannel(key) {
  if (!channels.has(key)) channels.set(key, createRetryChannel());
  return channels.get(key);
}

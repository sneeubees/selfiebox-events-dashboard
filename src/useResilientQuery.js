import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueries } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { convexToJson } from 'convex/values';
import { getRetryChannel, NO_RETRY_CHANNEL } from './queryRetry';

// A first load still failing after this many retries gets the "still trying"
// message, not sooner: a retry that is about to succeed takes a second or two,
// and the message should not flash up for that.
const RETRIES_BEFORE_STILL_TRYING = 2;

// Like useQuery from convex/react, except a failed query does not throw. useQuery
// rethrows the Error that useQueries hands back, which takes the whole dashboard
// down to the error boundary until someone reloads the page. Here the error stays
// inside the hook and the query is retried for as long as it keeps failing.
//
// A failed Convex subscription stays failed until its data changes, so the retry
// drops the subscription and adds it again, which sends the server a Remove and
// then an Add under a new query id. That only happens once EVERY hook on the same
// query + args has let go (see queryRetry.js); args themselves never change.
//
// Returns [data, load]. data is what useQuery would return: undefined while
// loading or skipped. During a failure it stays the last good result for these
// same args, never another year's, or undefined if there is none yet.
//   load.failing      the query is failing now, so data may be out of date
//   load.stale        failing, and data is the last good result
//   load.stillTrying  failing with nothing to show after a couple of attempts
export function useResilientQuery(query, args) {
  const skip = args === 'skip';
  const queryKey = skip ? null : `${getFunctionName(query)}|${JSON.stringify(convexToJson(args ?? {}))}`;
  const channel = skip ? NO_RETRY_CHANNEL : getRetryChannel(queryKey);
  const retry = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  const subscribed = !skip && !retry.dropped;

  const queries = useMemo(
    () => (subscribed ? { query: { query, args: args ?? {} } } : {}),
    // Keyed on the stringified args like useQuery, so a new args object with the
    // same contents does not resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, subscribed]
  );
  const result = useQueries(queries).query;
  const failed = result instanceof Error;
  const hasResult = !failed && result !== undefined;

  const lastGoodRef = useRef(null);
  useEffect(() => {
    if (hasResult) lastGoodRef.current = { queryKey, value: result };
  }, [hasResult, queryKey, result]);

  useEffect(() => {
    if (failed) {
      // The error boundary used to log this. Without it, a failure that never
      // clears would leave no trace to work from.
      console.error('Query failed, retrying', result);
      channel.reportFailure();
    } else if (hasResult) {
      channel.reportSuccess();
    }
  }, [channel, failed, hasResult, result]);

  // While a retry is running, result is an old cached error or undefined. Neither
  // says the query recovered, so only a real result ends the failure.
  const failing = failed || (!hasResult && retry.failing);
  const lastGood = failing && lastGoodRef.current?.queryKey === queryKey ? lastGoodRef.current : null;

  return [
    hasResult ? result : lastGood?.value,
    {
      failing,
      stale: Boolean(lastGood),
      stillTrying: failing && !lastGood && retry.retries >= RETRIES_BEFORE_STILL_TRYING,
    },
  ];
}

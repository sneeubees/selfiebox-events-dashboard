// CI=true npx react-scripts test --watchAll=false src/useResilientQuery.test.js
// Runs the real ConvexReactClient over a fake WebSocket, so these tests read what
// actually goes to the server (the Remove and Add messages) instead of trusting a
// mock of convex/react.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, renderHook } from '@testing-library/react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { useResilientQuery } from './useResilientQuery';

const listYear = makeFunctionReference('events:listByWorkspaceYear');
const TIMED_OUT = 'Function execution timed out (maximum duration: 1s)';
const year = (workspaceYear) => ({ workspaceYear });

const encodeTs = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes.toString('base64');
};

// Speaks just enough of the Convex sync protocol to answer one client.
function createFakeServer() {
  const server = { wire: [] };
  let socket = null;
  let querySet = 0;
  let version = { querySet: 0, identity: 0, ts: 0 };

  server.WebSocket = class {
    constructor() {
      socket = this;
    }

    send(data) {
      const message = JSON.parse(data);
      if (message.type !== 'ModifyQuerySet') return;
      querySet = message.newVersion;
      server.wire.push(...message.modifications);
    }

    close() {
      this.onclose?.({ code: 1000, reason: '' });
    }
  };

  const wireVersion = (state) => ({ ...state, ts: encodeTs(state.ts) });
  const transition = (modifications) => {
    const endVersion = { querySet, identity: 0, ts: version.ts + 1 };
    socket.onmessage({ data: JSON.stringify({ type: 'Transition', startVersion: wireVersion(version), endVersion: wireVersion(endVersion), modifications }) });
    version = endVersion;
  };

  server.open = () => socket.onopen();
  server.ping = () => socket?.onopen && socket.onmessage?.({ data: JSON.stringify({ type: 'Ping' }) });
  server.adds = (workspaceYear) => server.wire.filter((change) => change.type === 'Add' && change.args[0].workspaceYear === workspaceYear);
  server.removes = () => server.wire.filter((change) => change.type === 'Remove');
  server.liveId = (workspaceYear) => server.adds(workspaceYear).at(-1).queryId;
  server.succeed = (queryId, value) => transition([{ type: 'QueryUpdated', queryId, value, logLines: [], journal: null }]);
  server.fail = (queryId, errorMessage = TIMED_OUT) => transition([{ type: 'QueryFailed', queryId, errorMessage, logLines: [], journal: null }]);
  server.confirmRemoved = (queryId) => transition([{ type: 'QueryRemoved', queryId }]);
  server.unrelated = () => transition([]);
  return server;
}

let server;
let client;
let wrapper;

function createClient() {
  server = createFakeServer();
  client = new ConvexReactClient('https://fake.convex.cloud', { webSocketConstructor: server.WebSocket, unsavedChangesWarning: false });
  wrapper = ({ children }) => <ConvexProvider client={client}>{children}</ConvexProvider>;
}

// Small steps, one act() each: a real browser lets React commit between two timers,
// while one big act() would hold every render back until the end of it.
function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    act(() => {
      jest.advanceTimersByTime(50);
      if (elapsed % 10000 === 0) server.ping();
    });
  }
}

function send(callback) {
  act(() => callback());
}

function renderQuery(initialArgs) {
  return renderHook(({ args }) => useResilientQuery(listYear, args), { wrapper, initialProps: { args: initialArgs } });
}

// Failures are logged on purpose; keep them out of the test output.
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('with fake timers', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
    createClient();
  });

  afterEach(async () => {
    await client.close();
    jest.useRealTimers();
  });

  function loadedBoard(rows, workspaceYear = 2026) {
    const view = renderQuery(year(workspaceYear));
    send(() => server.open());
    send(() => server.succeed(server.liveId(workspaceYear), rows));
    return view;
  }

  test('a query that works behaves like useQuery: undefined, then rows, then live updates', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    expect(view.result.current[0]).toBeUndefined();
    expect(view.result.current[1]).toEqual({ failing: false, stale: false, stillTrying: false });

    const id = server.liveId(2026);
    send(() => server.succeed(id, [{ id: 'a' }]));
    expect(view.result.current[0]).toEqual([{ id: 'a' }]);
    send(() => server.succeed(id, [{ id: 'a' }, { id: 'b' }]));
    expect(view.result.current[0]).toHaveLength(2);

    advance(120000);
    expect(server.wire).toHaveLength(1);
  });

  test('new args objects with the same contents do not resubscribe', () => {
    const view = loadedBoard([]);
    view.rerender({ args: year(2026) });
    view.rerender({ args: year(2026) });
    expect(server.wire).toHaveLength(1);
  });

  test("'skip' subscribes to nothing, retries nothing, and starts when the args arrive", () => {
    const view = renderQuery('skip');
    expect(view.result.current).toEqual([undefined, { failing: false, stale: false, stillTrying: false }]);
    advance(60000);
    expect(server.wire).toHaveLength(0);

    view.rerender({ args: year(2026) });
    send(() => server.open());
    expect(server.adds(2026)).toHaveLength(1);
    expect(view.result.current[0]).toBeUndefined();
  });

  test('a failed first load is handed back as loading, not thrown', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    expect(view.result.current[0]).toBeUndefined();
    expect(view.result.current[1]).toEqual({ failing: true, stale: false, stillTrying: false });
  });

  test('a failure is logged, since the error boundary no longer sees it, without looping', () => {
    renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][1].message).toContain(TIMED_OUT);
    advance(1500);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test('a retry really reaches the server: Remove, then Add with a new id and the same args', () => {
    renderQuery(year(2026));
    send(() => server.open());
    const firstId = server.liveId(2026);
    send(() => server.fail(firstId));
    expect(server.removes()).toHaveLength(0);

    advance(2000);
    expect(server.removes()).toEqual([{ type: 'Remove', queryId: firstId }]);
    expect(server.adds(2026)).toHaveLength(1);

    advance(250);
    expect(server.adds(2026)).toHaveLength(2);
    const retried = server.adds(2026)[1];
    expect(retried.queryId).not.toBe(firstId);
    expect(retried.udfPath).toBe(server.adds(2026)[0].udfPath);
    expect(retried.args).toEqual(server.adds(2026)[0].args);
    expect(server.wire.map((change) => change.type)).toEqual(['Add', 'Remove', 'Add']);
  });

  test('retries keep to the schedule and go on for as long as the query keeps failing', () => {
    renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));

    const addsAfter = (ms) => {
      advance(ms);
      send(() => server.fail(server.liveId(2026)));
      return server.adds(2026).length;
    };
    expect(addsAfter(2250)).toBe(2);
    expect(addsAfter(5250)).toBe(3);
    expect(addsAfter(10250)).toBe(4);
    expect(addsAfter(30250)).toBe(5);
    expect(addsAfter(30250)).toBe(6);
    expect(addsAfter(30250)).toBe(7);
  });

  test('two hooks on one year share a subscription and the retry still reaches the server', () => {
    // The board plus a report on the same year: Convex sends one Add for both, and
    // dropping only one of them would send no Remove at all.
    const board = renderQuery(year(2026));
    const report = renderQuery(year(2026));
    send(() => server.open());
    expect(server.adds(2026)).toHaveLength(1);
    send(() => server.fail(server.liveId(2026)));
    expect(board.result.current[1].failing).toBe(true);
    expect(report.result.current[1].failing).toBe(true);

    advance(2000);
    expect(server.removes()).toHaveLength(1);
    advance(250);
    expect(server.adds(2026)).toHaveLength(2);
    expect(server.wire.map((change) => change.type)).toEqual(['Add', 'Remove', 'Add']);

    send(() => server.succeed(server.liveId(2026), [{ id: 'a' }]));
    expect(board.result.current[0]).toEqual([{ id: 'a' }]);
    expect(report.result.current[0]).toEqual([{ id: 'a' }]);
  });

  test('a report opened during a failure shares the retries and cannot hold the query open', () => {
    const board = loadedBoard([{ id: 'a' }]);
    send(() => server.fail(server.liveId(2026)));
    advance(1000);
    const report = renderQuery(year(2026));
    expect(report.result.current[0]).toBeUndefined();

    advance(1000);
    advance(250);
    expect(server.removes()).toHaveLength(1);
    expect(server.adds(2026)).toHaveLength(2);
    expect(board.result.current[0]).toEqual([{ id: 'a' }]);
  });

  test('during a failure the last good rows stay, through every step of a retry', () => {
    const rows = [{ id: 'a' }];
    const view = loadedBoard(rows);
    const shown = () => view.result.current[0];
    const before = shown();

    send(() => server.fail(server.liveId(2026)));
    expect(shown()).toBe(before);
    expect(view.result.current[1]).toEqual({ failing: true, stale: true, stillTrying: false });

    const failedId = server.liveId(2026);
    advance(2000); // dropped
    expect(shown()).toBe(before);
    send(() => server.confirmRemoved(failedId)); // the cached error is now gone
    expect(shown()).toBe(before);
    advance(250); // added back, nothing from the server yet
    expect(shown()).toBe(before);
    expect(view.result.current[1].failing).toBe(true);
    send(() => server.unrelated());
    expect(shown()).toBe(before);
    expect(view.result.current[1].failing).toBe(true);
  });

  test('the old error Convex still has cached straight after a retry does not end or restart anything', () => {
    const view = loadedBoard([{ id: 'a' }]);
    send(() => server.fail(server.liveId(2026)));
    advance(2250); // no server message since the Remove, so the error is still cached
    expect(view.result.current[1].failing).toBe(true);
    expect(server.adds(2026)).toHaveLength(2);
    advance(4900);
    expect(server.adds(2026)).toHaveLength(2);
    advance(350);
    expect(server.removes()).toHaveLength(2);
  });

  test('recovery shows the fresh rows, clears the notice and stops retrying', () => {
    const view = loadedBoard([{ id: 'old' }]);
    send(() => server.fail(server.liveId(2026)));
    advance(2250);
    send(() => server.succeed(server.liveId(2026), [{ id: 'fresh' }]));
    expect(view.result.current).toEqual([[{ id: 'fresh' }], { failing: false, stale: false, stillTrying: false }]);

    const wireSoFar = server.wire.length;
    advance(120000);
    expect(server.wire).toHaveLength(wireSoFar);
  });

  test('a later failure starts again from the 2 s retry', () => {
    const view = loadedBoard([{ id: 'a' }]);
    send(() => server.fail(server.liveId(2026)));
    advance(2250);
    send(() => server.succeed(server.liveId(2026), [{ id: 'b' }]));

    send(() => server.fail(server.liveId(2026)));
    expect(view.result.current[0]).toEqual([{ id: 'b' }]);
    advance(2250);
    expect(server.adds(2026)).toHaveLength(3);
  });

  test('a query that fails on its own, with data changing later, recovers without a retry', () => {
    const view = loadedBoard([{ id: 'a' }]);
    send(() => server.fail(server.liveId(2026)));
    advance(1000);
    send(() => server.succeed(server.liveId(2026), [{ id: 'b' }]));
    expect(view.result.current[1].failing).toBe(false);
    advance(60000);
    expect(server.adds(2026)).toHaveLength(1);
  });

  test("changing year never shows the old year's rows and stops the old year's retries", () => {
    const view = loadedBoard([{ id: 'rows-2026' }], 2026);
    send(() => server.fail(server.liveId(2026)));
    expect(view.result.current[0]).toEqual([{ id: 'rows-2026' }]);

    view.rerender({ args: year(2025) });
    expect(view.result.current[0]).toBeUndefined();
    expect(view.result.current[1].failing).toBe(false);

    advance(60000);
    expect(server.adds(2026)).toHaveLength(1);
    expect(server.adds(2025)).toHaveLength(1);
    send(() => server.fail(server.liveId(2025)));
    expect(view.result.current[0]).toBeUndefined();
    expect(view.result.current[1].stale).toBe(false);
  });

  test('coming back to a year does not bring its old rows back during a failure', () => {
    const view = loadedBoard([{ id: 'rows-2026' }], 2026);
    view.rerender({ args: year(2025) });
    send(() => server.succeed(server.liveId(2025), [{ id: 'rows-2025' }]));
    view.rerender({ args: year(2026) });
    send(() => server.fail(server.liveId(2026)));
    expect(view.result.current[0]).toBeUndefined();
  });

  test('the still-trying message waits until two retries have gone by', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    advance(2250); // retry 1, now running
    expect(view.result.current[1].stillTrying).toBe(false);
    advance(4950);
    expect(view.result.current[1].stillTrying).toBe(false);
    advance(50); // retry 2 starts, so retry 1 has not worked
    expect(view.result.current[1]).toEqual({ failing: true, stale: false, stillTrying: true });

    advance(250);
    send(() => server.succeed(server.liveId(2026), []));
    expect(view.result.current).toEqual([[], { failing: false, stale: false, stillTrying: false }]);
  });

  test('going to skip stops the retries', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    view.rerender({ args: 'skip' });
    expect(view.result.current[1].failing).toBe(false);
    advance(60000);
    expect(server.adds(2026)).toHaveLength(1);
  });

  test('unmounting stops the retries', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    view.unmount();
    const wireSoFar = server.wire.length;
    advance(60000);
    expect(server.wire).toHaveLength(wireSoFar);
  });

  test('unmounting during the drop gap leaves nothing behind', () => {
    const view = renderQuery(year(2026));
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    advance(2000);
    view.unmount();
    const wireSoFar = server.wire.length;
    advance(60000);
    expect(server.wire).toHaveLength(wireSoFar);
  });

  test('works in React.StrictMode, which the app runs in', () => {
    const strictWrapper = ({ children }) => <React.StrictMode><ConvexProvider client={client}>{children}</ConvexProvider></React.StrictMode>;
    const view = renderHook(() => useResilientQuery(listYear, year(2026)), { wrapper: strictWrapper });
    send(() => server.open());
    send(() => server.fail(server.liveId(2026)));
    advance(2250);
    const adds = server.adds(2026).length;
    send(() => server.succeed(server.liveId(2026), [{ id: 'a' }]));
    expect(view.result.current[0]).toEqual([{ id: 'a' }]);
    advance(60000);
    expect(server.adds(2026)).toHaveLength(adds);
  });
});

// No act() and no fake timers here: this is the only test where React schedules the
// way it does in a browser, so it checks the claim the drop gap rests on, that every
// hook has really dropped before the gap's timer can run.
test('with real timers, two hooks both drop before the query is added back', async () => {
  const wasActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  createClient();

  const seen = [];
  const Hook = ({ name }) => {
    seen[name] = useResilientQuery(listYear, year(2026));
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  root.render(<ConvexProvider client={client}><Hook name="board" /><Hook name="report" /></ConvexProvider>);
  await new Promise((resolve) => setTimeout(resolve, 20));

  server.open();
  server.fail(server.liveId(2026));
  await new Promise((resolve) => setTimeout(resolve, 2600));

  expect(server.wire.map((change) => change.type)).toEqual(['Add', 'Remove', 'Add']);
  expect(seen.board[1].failing).toBe(true);
  expect(seen.report[1].failing).toBe(true);

  root.unmount();
  await client.close();
  globalThis.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
}, 10000);

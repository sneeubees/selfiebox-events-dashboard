// Linked bookings: Snappic is copied to the other days only when the user
// chose "All linked rows" (Nicole, 26 Oct 2026: ticking it on one day silently
// ticked every day). Other shared fields still copy as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// bookingGroups.js imports Convex's generated server file (extensionless, which
// node can't resolve); swap the two imports for stubs and load the rest as is.
const source = (await readFile(new URL('./src/convex/bookingGroups.js', import.meta.url), 'utf8'))
  .replace(/^import \{ v \} from "convex\/values";$/m, 'const v = new Proxy({}, { get: () => () => ({}) });')
  .replace(/^import \{ mutation, query \} from "\.\/_generated\/server";$/m, 'const mutation = (definition) => definition; const query = (definition) => definition;');
assert.ok(!/^import /m.test(source), 'all imports were stubbed');
const { fanOutSharedFields } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function fakeCtx(rows) {
  const patches = [];
  const logs = [];
  const ctx = {
    db: {
      query: (table) => ({
        withIndex: (_name, build) => {
          let wanted = null;
          build({ eq: (_field, value) => { wanted = value; return {}; } });
          return { collect: async () => rows.filter((row) => row.bookingGroupId === wanted) };
        },
        collect: async () => (table === 'customColumns' ? [] : rows),
      }),
      patch: async (id, patch) => { patches.push({ id, patch }); },
      insert: async (_table, doc) => { logs.push(doc); },
    },
  };
  return { ctx, patches, logs };
}

const row = (id, over = {}) => ({ _id: id, bookingGroupId: 'grp-1', date: `2026-11-0${id.slice(-1)}`, createdAt: 1, name: 'Acme', snappic: '', invoiceNumber: '', ...over });

test('ticking Snappic on one linked day leaves the other days alone by default', async () => {
  const before = row('e1');
  const after = row('e1', { snappic: 'Yes' });
  const { ctx, patches } = fakeCtx([after, row('e2')]);
  const count = await fanOutSharedFields(ctx, before, after, null, {});
  assert.equal(count, 0);
  assert.deepEqual(patches, []);
});

test('"All linked rows" copies Snappic to every other day', async () => {
  const before = row('e1');
  const after = row('e1', { snappic: 'Yes' });
  const { ctx, patches, logs } = fakeCtx([after, row('e2'), row('e3')]);
  const count = await fanOutSharedFields(ctx, before, after, null, { applySnappicToGroup: true });
  assert.equal(count, 2);
  assert.deepEqual(patches.map((p) => [p.id, p.patch.snappic]), [['e2', 'Yes'], ['e3', 'Yes']]);
  assert.match(logs[0].text, /snappic/);
});

test('other shared fields still copy without asking, and Snappic stays per day', async () => {
  const before = row('e1');
  const after = row('e1', { snappic: 'Yes', invoiceNumber: 'INV-9' });
  const { ctx, patches } = fakeCtx([after, row('e2')]);
  await fanOutSharedFields(ctx, before, after, null, {});
  assert.equal(patches.length, 1);
  assert.equal(patches[0].patch.invoiceNumber, 'INV-9');
  assert.equal('snappic' in patches[0].patch, false);
});

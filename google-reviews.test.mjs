import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./src/convex/googleReviewsClient.js', import.meta.url), 'utf8');
const { allPages, googleGet, locationResource } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('resource validation rejects paths and other hosts', () => {
  assert.equal(locationResource('accounts/123/locations/456'), 'accounts/123/locations/456');
  for (const bad of ['https://evil.test', 'accounts/12/locations/../reviews', 'accounts/1/locations/2?x=1']) assert.throws(() => locationResource(bad));
});
test('account and location pagination preserves all results and encodes tokens', async () => {
  const urls = [];
  const data = await allPages('https://example.test/?pageSize=20', 'accounts', 'private-token', async (url, options) => {
    urls.push(url); assert.equal(options.headers.Authorization, 'Bearer private-token');
    return { ok: true, json: async () => urls.length === 1 ? { accounts: [1], nextPageToken: 'a+b&c' } : { accounts: [2] } };
  });
  assert.deepEqual(data, [1, 2]);
  assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'a+b&c');
});
test('pagination detects repeated tokens', async () => {
  await assert.rejects(allPages('https://example.test', 'accounts', 'token', async () => ({ ok: true, json: async () => ({ nextPageToken: 'again' }) })), /repeated page token/);
});
test('API errors are actionable and do not leak response content', async () => {
  for (const code of [401, 403, 429, 500]) {
    await assert.rejects(googleGet('https://example.test', 'secret', async () => ({ ok: false, status: code })), error => !error.message.includes('secret'));
  }
});

const backendSource = (await readFile(new URL('./src/convex/googleReviews.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');
const backend = await import('data:text/javascript;base64,' + Buffer.from(`
  const v = { string: () => null, id: () => null };
  const query = x => x, mutation = x => x, internalQuery = x => x, internalMutation = x => x;
  ${backendSource}`).toString('base64'));
function fakeContext(role = 'admin') {
  const rows = [{ _id: 'user1', table: 'users', clerkId: 'clerk1', email: 'admin@example.test', isApproved: true, isActive: true, role }];
  return { rows, auth: { getUserIdentity: async () => ({ subject: 'clerk1', email: 'admin@example.test' }) }, db: {
    query(table) {
      let filters = [];
      const builder = { withIndex(_index, fn) { const q = { eq(key, value) { filters.push([key, value]); return q; } }; fn(q); return builder; },
        collect: async () => rows.filter(r => r.table === table && filters.every(([k, value]) => r[k] === value)),
        unique: async () => (await builder.collect())[0] || null };
      return builder;
    },
    get: async id => rows.find(r => r._id === id),
    insert: async (table, row) => rows.push({ table, ...row, _id: 'row' + rows.length }),
    delete: async id => { const i = rows.findIndex(r => r._id === id); if (i >= 0) rows.splice(i, 1); },
    patch: async (id, patch) => Object.assign(rows.find(r => r._id === id), patch),
  } };
}
test('unauthenticated and non-admin callers cannot view connection or disconnect', async () => {
  const ctx = fakeContext('user');
  await assert.rejects(backend.status.handler(ctx), /Admins only/);
  await assert.rejects(backend.disconnect.handler(ctx), /Admins only/);
  ctx.auth.getUserIdentity = async () => null;
  await assert.rejects(backend.status.handler(ctx), /Not authenticated/);
});
test('OAuth state is single-use and expired states are rejected', async () => {
  const ctx = fakeContext();
  await backend.saveState.handler(ctx, { digest: 'valid', verifier: 'pkce', userId: 'user1' });
  assert.equal((await backend.consumeState.handler(ctx, { digest: 'valid' })).verifier, 'pkce');
  await assert.rejects(backend.consumeState.handler(ctx, { digest: 'valid' }), /expired/);
  await backend.saveState.handler(ctx, { digest: 'old', verifier: 'pkce', userId: 'user1' });
  ctx.rows.find(r => r.digest === 'old').expiresAt = Date.now() - 1;
  await assert.rejects(backend.consumeState.handler(ctx, { digest: 'old' }), /expired/);
});
test('disconnect removes review credentials and pending states without touching Analytics', async () => {
  const ctx = fakeContext();
  ctx.rows.push({ table: 'integrations', _id: 'ga4', key: 'ga4', refreshToken: 'analytics' });
  await backend.saveToken.handler(ctx, { userId: 'user1', refreshToken: 'reviews' });
  await backend.saveState.handler(ctx, { userId: 'user1', digest: 'pending', verifier: 'pkce' });
  await backend.disconnect.handler(ctx);
  assert.equal(ctx.rows.filter(r => r.table === 'integrations').length, 1);
  assert.equal(ctx.rows.find(r => r.key === 'ga4').refreshToken, 'analytics');
  assert.equal(ctx.rows.filter(r => r.table === 'googleReviewOAuthStates').length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/http.mjs';
import { driveFileId, authorizationUrl } from '../server/google.mjs';

test('OAuth flow is one-time, state-bound; admin is pinned to verified Google identity', () => {
  const store = createStore(':memory:', ['owner@gmail.com', 'owner@example.com']);
  const flow = store.startOAuth();
  assert.equal(store.consumeOAuth(flow.token, 'wrong'), null);
  assert.equal(store.consumeOAuth('wrong', flow.state), null);
  assert.equal(store.consumeOAuth(flow.token, flow.state).nonce, flow.nonce);
  assert.equal(store.consumeOAuth(flow.token, flow.state), null);
  const owner = store.login({ sub: 'owner', email: 'owner@gmail.com' });
  assert.equal(store.session(owner).role, 'admin');
  const impersonator = store.login({ sub: 'other', email: 'owner@gmail.com' });
  assert.equal(store.session(impersonator).role, 'member');
  const nonHosted = store.login({ sub: 'external', email: 'owner@example.com' });
  assert.equal(store.session(nonHosted).role, 'member');
  const workspace = store.login({ sub: 'workspace', email: 'owner@example.com', hd: 'example.com' });
  assert.equal(store.session(workspace).role, 'admin');
  assert.equal(store.setStatus('owner', 'owner', 'rejected'), false);
  store.logout(owner); assert.equal(store.session(owner), null);
  store.close();
});

test('OAuth authorization requests include PKCE, state, nonce, fixed callback', () => {
  const url = new URL(authorizationUrl({ clientId: 'client', origin: 'https://example.com' }, { state: 'state', nonce: 'nonce', verifier: 'verifier' }));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/auth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.get('nonce'), 'nonce');
});

test('Drive image parser rejects arbitrary hosts, URLs and malformed IDs', () => {
  assert.equal(driveFileId('https://drive.google.com/file/d/abcdefghijk/view'), 'abcdefghijk');
  for (const url of ['http://drive.google.com/file/d/abcdefghijk', 'https://drive.google.com.evil.com/file/d/abcdefghijk', 'http://127.0.0.1/a', 'javascript:alert(1)', 'https://drive.google.com/open?id=../secrets']) assert.equal(driveFileId(url), null);
});

test('HTTP authorization, direct-file denial, approval, revocation, CSRF and logout', async t => {
  const store = createStore(':memory:', ['owner@gmail.com']);
  let status = '대기', outage = false, imageReads = 0;
  const source = { configured: true,
    accessRows: async () => { if (outage) throw new Error(); return [{ sub: 'member', email: 'member@gmail.com', status }]; },
    notes: async () => ({ records: [{ title: 'SECRET' }] }),
    image: async () => { imageReads++; return { type: 'image/png', body: Buffer.from('IMAGE') }; },
    setAccess: async (sub, next) => { assert.equal(sub, 'member'); status = next; },
    refresh: async () => {}, recordLogin: async () => {} };
  const config = { origin: 'http://127.0.0.1:4174', clientId: 'client', clientSecret: 'secret', adminEmails: ['owner@gmail.com'] };
  const server = createApp({ config, store, source });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const member = store.login({ sub: 'member', email: 'member@gmail.com' });
  const admin = store.login({ sub: 'owner', email: 'owner@gmail.com' });
  const get = (path, token) => fetch(origin + path, { headers: token ? { cookie: `chae_session=${token}` } : {} });
  const post = (path, token, payload, csrf = store.session(token)?.csrf, from = config.origin) => fetch(origin + path, {
    method: 'POST', headers: { cookie: `chae_session=${token}`, origin: from, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  for (const path of ['/api/notes','/api/images/abcdefghijk','/api/admin/users']) assert.equal((await get(path)).status, 401);
  for (const path of ['/data/local-notes.json','/data/company-notes.json','/sample-data.csv','/.env','/.private/access.sqlite','/server/index.mjs','/SETUP.md','/.git/config']) assert.equal((await get(path, admin)).status, 404);
  assert.equal((await get('/api/notes', member)).status, 403);
  assert.equal((await get('/api/images/abcdefghijk', member)).status, 403);
  assert.equal(imageReads, 0);
  assert.equal((await post('/api/admin/users', admin, {sub:'member',status:'승인'}, 'bad')).status, 403);
  assert.equal((await post('/api/admin/users', admin, {sub:'member',status:'승인'}, undefined, 'https://evil.example')).status, 403);
  assert.equal((await post('/api/admin/users', admin, {sub:'member',status:'승인'})).status, 200);
  assert.equal((await get('/api/notes', member)).status, 200);
  assert.equal((await get('/api/admin/users', member)).status, 403);
  assert.equal((await post('/api/admin/users', member, {sub:'member',status:'승인'})).status, 403);
  const image = await get('/api/images/abcdefghijk', member);
  assert.equal(image.status, 200); assert.equal(image.headers.get('cache-control'), 'no-store');
  status = '차단';
  assert.equal((await get('/api/notes', member)).status, 403);
  assert.equal((await get('/api/images/abcdefghijk', member)).status, 403);
  outage = true; assert.equal((await get('/api/notes', member)).status, 503);
  outage = false; status = '승인';
  assert.equal((await post('/api/logout', member, {})).status, 200);
  assert.equal((await get('/api/notes', member)).status, 401);
  const callback = await fetch(origin + '/auth/callback?state=forged&code=forged', {redirect:'manual'});
  assert.equal(callback.headers.get('location'), '/?auth=failed');
});


import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
test('temporary session-check failures preserve the approved screen; revocation locks it', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, close() {}, replaceChildren() {} });
    return elements.get(id);
  };
  const user = { sub: 'owner', role: 'admin', status: 'approved', email: 'owner@example.com' };
  let failure;
  const window = {
    ZIP_API: {
      hasSession: true, clearImages() {},
      async config() { return { ok: true, configured: true, clientId: 'test' }; },
      async request() { if (failure) throw failure; return { user }; }
    },
    addEventListener() {}, dispatchEvent() {}
  };
  vm.runInNewContext(source, {
    window, document: {
      body: { classList: { remove() {} } }, head: { append() {} },
      getElementById: element, querySelector: element,
      createElement: () => ({}), addEventListener() {}, hidden: false
    }, setInterval() {}, Event, CustomEvent, Date
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.CHAE_AUTH.user, user);
  failure = new TypeError('Failed to fetch');
  await window.CHAE_AUTH.check();
  assert.equal(window.CHAE_AUTH.user, user);
  assert.equal(element('private-app').hidden, false);
  failure = Object.assign(new Error('Access revoked'), { code: 'FORBIDDEN' });
  await window.CHAE_AUTH.check();
  assert.equal(window.CHAE_AUTH.user, null);
  assert.equal(element('private-app').hidden, true);
});

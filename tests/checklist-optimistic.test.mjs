import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../checklist.js', import.meta.url), 'utf8');
function setup() {
  const requests = [];
  const context = {
    items: [{ row: 2, done: false }, { row: 3, done: false }],
    pendingRows: new Set(), revision: 0, accessVersion: 0, saving: false,
    window: { CHAE_AUTH: { user: { role: 'admin' } } }, message: {}, render() {},
    list: { addEventListener: (_, fn) => { context.change = fn; } },
    api: { request: (action, payload) => new Promise((resolve, reject) => requests.push({ action, payload, resolve, reject })) }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  list.addEventListener("change"'), source.indexOf('  dateInput.value = selectedDate;', source.indexOf('  list.addEventListener("change"'))), context);
  const click = (row, checked) => context.change({ target: { closest: () => ({ dataset: { checklistRow: String(row) }, checked }) } });
  return { context, requests, click };
}
test('updates immediately, permits another row, prevents duplicate saves, and skips reload', async () => {
  const { context: c, requests: r, click } = setup();
  const first = click(2, true);
  assert.equal(c.items[0].done, true);
  await click(2, false);
  const second = click(3, true);
  assert.equal(r.length, 2);
  assert.equal(c.items[1].done, true);
  r[0].resolve({ ok: true }); r[1].resolve({ ok: true });
  await Promise.all([first, second]);
  assert.equal(c.pendingRows.size, 0);
  assert.equal(r.every(x => x.action === 'toggleChecklist'), true);
});
test('failure rolls back only the affected row and allows retry', async () => {
  const { context: c, requests: r, click } = setup();
  const pending = click(2, true);
  r[0].reject(Error('offline'));
  await pending;
  assert.equal(c.items[0].done, false);
  assert.equal(c.pendingRows.size, 0);
  assert.match(c.message.textContent, /되돌렸어요/);
});
test('late failure after logout does not mutate a new session', async () => {
  const { context: c, requests: r, click } = setup();
  const pending = click(2, true);
  c.accessVersion++;
  c.pendingRows.clear();
  c.items = [];
  c.message.textContent = 'logged out';
  r[0].reject(Error('late'));
  await pending;
  assert.equal(c.message.textContent, 'logged out');
  assert.equal(c.items.length, 0);
});
test('stale refresh cannot overwrite an optimistic edit', async () => {
  const { context: c, requests: r } = setup();
  vm.runInContext(source.slice(source.indexOf('  async function fetchItems()'), source.indexOf('  navButton.addEventListener')), c);
  const pending = c.fetchItems();
  c.revision++;
  c.items[0].done = true;
  r[0].resolve({ items: [{ row: 2, done: false }] });
  await pending;
  assert.equal(c.items[0].done, true);
});


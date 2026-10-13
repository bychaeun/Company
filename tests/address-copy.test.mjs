import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('  async function copyAddress('), source.indexOf('  function editorValue('));
function setup(clipboard) {
  const status = { textContent: '' };
  const button = { disabled: false, parentElement: { querySelector: () => status }, focus() {} };
  const context = { navigator: { clipboard }, state: { currentRecordId: 1, records: [{ id: 1, address: '서울 테스트길 10 & 2층' }] } };
  vm.createContext(context);
  vm.runInContext(fn, context);
  return { context, button, status };
}
test('copies exact address and displays success', async () => {
  let copied;
  const { context, button, status } = setup({ writeText: async text => { copied = text; } });
  await context.copyAddress(button);
  assert.equal(copied, '서울 테스트길 10 & 2층');
  assert.equal(status.textContent, '복사했어요!');
  assert.equal(button.disabled, false);
});
test('permission denial reports failure without claiming success', async () => {
  const { context, button, status } = setup({ writeText: async () => { throw Error('Denied'); } });
  await context.copyAddress(button);
  assert.match(status.textContent, /복사하지 못했어요/);
  assert.equal(button.disabled, false);
});
test('fallback copies inside modal and removes temporary field', async () => {
  const { context, button, status } = setup(undefined);
  let removed = false;
  let selected = false;
  const input = { select() { selected = true; }, remove() { removed = true; } };
  context.document = { createElement: () => input, execCommand: () => selected };
  context.el = { dialog: { append() {} } };
  await context.copyAddress(button);
  assert.equal(input.value, '서울 테스트길 10 & 2층');
  assert.equal(removed, true);
  assert.equal(status.textContent, '복사했어요!');
});
test('ignores repeated clicks while copying', async () => {
  let calls = 0;
  let finish;
  const { context, button } = setup({ writeText: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = context.copyAddress(button);
  await context.copyAddress(button);
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(button.disabled, false);
});


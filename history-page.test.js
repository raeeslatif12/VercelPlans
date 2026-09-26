import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

const history = { pushState() {}, replaceState() {} };
const location = { pathname: '/admin-dashboard', search: '', origin: 'http://localhost:3000' };
const context = {
  document: {
    getElementById: () => null,
    querySelector: selector => {
      if (selector === '#app') return { innerHTML: '', classList: { add() {}, remove() {} } };
      if (selector === '#toast') return { textContent: '', classList: { add() {}, remove() {} } };
      if (selector === '#earnings-toast-root') return { appendChild() {} };
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => ({
      className: '',
      innerHTML: '',
      textContent: '',
      style: {},
      addEventListener() {},
      appendChild() {},
      remove() {},
      setAttribute() {},
      querySelector() { return null; },
      classList: { add() {}, remove() {}, toggle() {} },
    }),
    addEventListener() {},
    body: { dataset: {} },
  },
  window: {
    location,
    history,
    addEventListener() {},
    innerWidth: 390,
  },
  location,
  history,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setTimeout: () => 1,
  clearTimeout: () => {},
  requestAnimationFrame: cb => { cb(); return 1; },
  URL,
  console,
};
context.globalThis = context;

vm.runInNewContext(source + '\n;globalThis.historyPage = historyPage;', context);

test('history page keeps a real table structure even when there are no withdrawals', () => {
  const html = context.historyPage([]);
  assert.match(html, /<table class="table withdrawal-table"/i, 'history page should keep the withdrawal table markup');
  assert.match(html, /<th>\s*Date & Time\s*<\/th>/i, 'history page should retain table headers');
  assert.match(html, /No withdrawals yet/i, 'history page should still show the empty-state copy');
});

'use strict';
/**
 * fetch(): the platform's own HTTP client is read like the axios one. The
 * method comes from the init object; none means GET; a variable is unread.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const react = require('../src/defaults/react');
const nestjs = require('../src/defaults/nestjs');

const FIX = path.join(__dirname, 'fixtures');
const be = scan(Object.assign({}, nestjs, { name: 'be', root: 'src', __dir: path.join(FIX, 'react-backend') }));
const files = {
  'api/things.ts': `
export const list = async () => (await fetch('/api/things')).json();
export const make = async (name: string) => {
  const res = await window.fetch('/api/things', { method: 'POST', body: JSON.stringify({ name }) });
  return res.json();
};
export const remove = async (id: number) => fetch(\`/api/things/\${id}\`, { method: "delete" });
export const generic = async (method: string, url: string) => fetch(url, { method });
export const refetch = () => 'not a call to fetch';
`,
};
const m = scan(Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(FIX, 'react'), apiPrefix: '/api' }),
  { files, backend: { model: be, label: 'be', cfg: {} } });
const http = Object.fromEntries(m.calls.filter((c) => c.kind === 'http').map((c) => [c.fromMethod, c]));

test('fetch calls are read: the method from the init object, GET by default', () => {
  assert.deepStrictEqual(Object.keys(http).sort(), ['generic', 'list', 'make', 'remove']);
  assert.deepStrictEqual(['list', 'make', 'remove'].map((n) => [http[n].verb, http[n].path]),
    [['GET', '/api/things'], ['POST', '/api/things'], ['DELETE', '/api/things/${id}']]);
});

test('and they are bridged like any other call', () => {
  assert.deepStrictEqual(['list', 'make', 'remove'].map((n) => http[n].endpoint),
    ['GET /things#execute', 'POST /things#execute', 'DELETE /things/:id#execute']);
});

test('a fetch whose URL and method are variables is unread, not guessed', () => {
  assert.deepStrictEqual([http.generic.verb, http.generic.path, http.generic.match], [null, null, 'unread']);
  assert.ok(m.diagnostics.some((d) => d.kind === 'http-unread' && /fetch\(…\)/.test(d.detail)));
});

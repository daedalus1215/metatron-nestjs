'use strict';
/**
 * Spec 01 — a route decorator must bind to the method that follows it,
 * whatever the file's indentation. See docs/specs/01-handler-detection-robustness.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const model = scan(Object.assign({}, nestjs, {
  name: 'fixture', root: '.',
  __dir: path.join(__dirname, 'fixtures', 'indentation'),
}));

const routesOf = (cls) => model.endpoints
  .filter((e) => e.cls === cls)
  .map((e) => `${e.verb} ${e.route}#${e.handler}`)
  .sort();

const diagsFor = (needle) => model.diagnostics.filter((d) => d.file.includes(needle));

test('every indentation style yields the same routes', () => {
  const expected = ['GET /notes/:id#findOne', 'POST /notes#create'].sort();
  for (const cls of ['TwoSpaceController', 'FourSpaceController', 'TabController']) {
    assert.deepStrictEqual(routesOf(cls), expected, `${cls} disagrees`);
  }
});

test('a four-space file does not bind to a later two-space method', () => {
  // The regression: `String.match` scanned forward past the intended method and
  // bound the route to `decoyTwoSpace`, 6 lines below, with full confidence.
  const handlers = model.endpoints
    .filter((e) => e.cls === 'FourSpaceController')
    .map((e) => e.handler);
  assert.ok(!handlers.includes('decoyTwoSpace'),
    'route bound to the decoy method — the indentation bug is back');
});

test('decorators with nested parens and comments are stepped over', () => {
  assert.deepStrictEqual(routesOf('ObjectPrefixController'),
    ['GET /notes/:id#findOne', 'POST /notes#create'].sort());
});

test('@Controller({ path }) yields the prefix', () => {
  const e = model.endpoints.find((x) => x.cls === 'ObjectPrefixController' && x.verb === 'GET');
  assert.strictEqual(e.route, '/notes/:id');
  assert.strictEqual(diagsFor('object-prefix').length, 0);
});

test('All, Head and Options are recognised', () => {
  const verbs = model.endpoints
    .filter((e) => e.cls === 'ExtraVerbsController')
    .map((e) => e.verb).sort();
  assert.deepStrictEqual(verbs, ['ALL', 'HEAD', 'OPTIONS']);
});

test('an array route argument is reported, not guessed at', () => {
  const d = diagsFor('extra-verbs');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'route-arg-unrecognised');
  assert.ok(d[0].line > 0, 'diagnostic carries a line number');
  assert.ok(!model.endpoints.some((e) => e.handler === 'arrayRoute'),
    'an uninterpretable route must not become an endpoint');
});

test('a decorator with no method after it is reported, not dropped', () => {
  const d = diagsFor('dangling');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'handler-unresolved');
});

test('diagnostics is always present on the model', () => {
  assert.ok(Array.isArray(model.diagnostics));
});

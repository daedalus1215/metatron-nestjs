'use strict';
/**
 * Spec 05 — a call through a port continues into the class a module binds to
 * it. See specs/05-port-adapter-resolution.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const model = scan(Object.assign({}, nestjs, {
  name: 'fixture', root: '.',
  __dir: path.join(__dirname, 'fixtures', 'ports'),
}));

const PORT = 'things/domain/ports/things.port.ts';
const ep = model.endpoints.find((e) => e.route === '/things/:id');
const hop = (method) => ep.flat.find((h) => h.method === method);
const diag = (token) => model.diagnostics.filter((d) => d.token === token);
const bound = (token) => model.bindings.filter((b) => b.token === token);

test('providers become a global binding table', () => {
  assert.deepStrictEqual(bound('THING_PORT').map((b) => [b.impl, b.via, b.module]),
    [['things/apps/adapters/thing.adapter.ts', 'useExisting', 'things/things.module.ts']]);
  assert.strictEqual(bound('FACTORY_PORT')[0].impl, null, 'a factory is recorded, never resolved');
  assert.strictEqual(bound('AMBIGUOUS_PORT').length, 2);
});

test('a provider after a useFactory arrow is still read', () => {
  // `=>` contains a `>`; a bracket-depth splitter loses everything after it.
  assert.strictEqual(bound('THING_PORT').length, 1);
  assert.strictEqual(bound('STRING_TOKEN').length, 1);
});

test('a call through a port continues into the bound class', () => {
  const h = hop('save');
  assert.strictEqual(h.file, 'things/apps/adapters/thing.adapter.ts');
  assert.strictEqual(h.cls, 'ThingAdapter');
  assert.strictEqual(h.kind, 'adapter');
  const repo = hop('persist');
  assert.ok(repo, 'the trace stopped at the adapter');
  assert.strictEqual(repo.depth, h.depth + 1);
  assert.strictEqual(repo.kind, 'repository');
});

test('the port stays visible on the hop', () => {
  const h = hop('save');
  assert.strictEqual(h.viaPort, 'ThingPort');
  assert.strictEqual(h.token, 'THING_PORT');
  assert.strictEqual(h.boundIn, 'things/things.module.ts');
  assert.ok(!('viaPort' in hop('hello')), 'ordinary injection must not be marked as a port');
});

test('a token provided in another module resolves', () => {
  const h = hop('go');
  assert.strictEqual(h.file, 'other/apps/adapters/class-impl.adapter.ts');
  assert.strictEqual(h.boundIn, 'other/other.module.ts');
});

test('a string token resolves', () => {
  assert.strictEqual(hop('shout').file, 'things/apps/adapters/string-impl.adapter.ts');
});

test('useFactory is reported, not followed', () => {
  assert.strictEqual(hop('make').file, PORT);
  assert.ok(!hop('make').viaPort);
  const d = diag('FACTORY_PORT');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'port-unbound');
  assert.match(d[0].detail, /useFactory/);
});

test('two modules binding one token differently is reported, not picked', () => {
  assert.strictEqual(hop('pick').file, PORT);
  const d = diag('AMBIGUOUS_PORT');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'port-ambiguous');
  assert.match(d[0].detail, /AmbiguousAAdapter/);
  assert.match(d[0].detail, /AmbiguousBAdapter/);
});

test('a token nobody provides is reported where it is injected', () => {
  const d = diag('UNBOUND_PORT');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'port-unbound');
  assert.strictEqual(d[0].file, 'things/domain/services/thing.service.ts');
  assert.strictEqual(d[0].line, 21);
});

test('a class used as its own token is ordinary DI, not a finding', () => {
  assert.strictEqual(diag('PlainService').length, 0);
  assert.strictEqual(hop('hello').file, 'things/domain/services/plain.service.ts');
});

test('exactly the expected diagnostics, nothing else', () => {
  assert.deepStrictEqual(model.diagnostics.map((d) => d.token).sort(),
    ['AMBIGUOUS_PORT', 'FACTORY_PORT', 'UNBOUND_PORT']);
});

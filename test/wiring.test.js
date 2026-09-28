'use strict';
/**
 * Spec 09 — the wiring model: bricks, sockets, studs.
 * See docs/specs/09-wiring-model.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const model = scan(Object.assign({}, nestjs, {
  name: 'fixture', root: '.',
  __dir: path.join(__dirname, 'fixtures', 'wiring'),
}));

const SVC = 'things/domain/services/thing.service.ts';
const brick = (id) => model.bricks.find((b) => b.id === id);

test('one brick per class, two classes in one file share an address', () => {
  assert.deepStrictEqual(model.bricks.filter((b) => b.file === SVC).map((b) => [b.id, b.lines]), [
    [SVC + '#ThingAuditor', [43, 51]],
    [SVC + '#ThingService', [8, 41]],
  ]);
  assert.deepStrictEqual(brick(SVC + '#ThingService').decorators, ['Injectable']);
});

test('a file of exported functions is one brick; a port with no class is hollow', () => {
  const utils = brick('things/domain/utils/date.utils.ts');
  assert.strictEqual(utils.shape, 'functions');
  assert.strictEqual(utils.name, 'date.utils');
  assert.strictEqual(brick('things/domain/ports/thing.port.ts').shape, 'port');
});

test('types-only files and test files produce no brick', () => {
  assert.ok(!model.bricks.some((b) => b.file.includes('thing.types.ts')));
  assert.ok(!model.bricks.some((b) => b.file.includes('__specs__')));
});

test('bricks are sorted by id, so two scans agree', () => {
  const ids = model.bricks.map((b) => b.id);
  assert.deepStrictEqual(ids, [...ids].sort());
});

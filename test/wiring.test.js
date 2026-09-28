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
    [SVC + '#ThingAuditor', [44, 55]],
    [SVC + '#ThingService', [9, 42]],
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

const sockets = (id) => brick(id).sockets.map((s) => [s.prop, s.status, s.to]);
const ACTION = 'things/apps/actions/get-thing.action.ts#GetThingAction';
const REPO = 'things/infra/repositories/thing.repository.ts#ThingRepository';

test('two classes in one file: neither borrows the other\'s sockets', () => {
  assert.deepStrictEqual(sockets(SVC + '#ThingService'), [
    ['thingRepository', 'resolved', REPO],
    ['clock', 'unresolved', null],
  ]);
  assert.deepStrictEqual(sockets(SVC + '#ThingAuditor'), [
    ['repo', 'resolved', REPO],
    ['reflector', 'framework', null],
  ]);
  assert.strictEqual(brick(SVC + '#ThingAuditor').sockets[1].from, '@nestjs/core');
});

test('a port socket keeps both ends: the port and the class bound to it', () => {
  const s = brick(ACTION).sockets.find((x) => x.prop === 'thingPort');
  assert.deepStrictEqual([s.status, s.to, s.boundTo, s.token], ['port', 'things/domain/ports/thing.port.ts',
    'things/apps/adapters/thing.adapter.ts#ThingAdapter', 'THING_PORT']);
  const w = model.wires.find((x) => x.from === ACTION && x.prop === 'thingPort');
  assert.deepStrictEqual([w.via, w.to, w.boundTo], ['port', s.to, s.boundTo]);
});

test('@InjectRepository is framework, typed against its entity', () => {
  const [s] = brick(REPO).sockets;
  assert.deepStrictEqual([s.status, s.external, s.entity],
    ['framework', 'Repository<Thing>', 'things/domain/entities/thing.entity.ts#Thing']);
});

test('an unresolved socket is counted and explained, once', () => {
  const d = model.diagnostics.filter((x) => x.kind === 'socket-unresolved');
  assert.deepStrictEqual(d.map((x) => [x.file, x.line]), [[SVC, 15]]);
  assert.deepStrictEqual(model.wiringMeta, { sockets: 8, resolved: 7, port: 1, framework: 2, unresolved: 1 });
});

test('wires are exactly the resolved and port sockets', () => {
  assert.strictEqual(model.wires.length, 5);
  assert.ok(model.wires.every((w) => w.to));
});

test('the trace reads the constructor of the class that owns the method', () => {
  const ep = model.endpoints.find((e) => e.route === '/things/:id');
  assert.deepStrictEqual(ep.flat.map((h) => [h.cls, h.method]), [
    ['ThingAdapter', 'ping'],
    ['ThingService', 'find'],
    ['ThingRepository', 'findById'],
  ]);
});

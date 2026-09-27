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
    [SVC + '#ThingAuditor', [46, 58]],
    [SVC + '#ThingService', [9, 44]],
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
  const { studs: _, ...sockets } = model.wiringMeta;
  assert.deepStrictEqual(sockets, { sockets: 9, resolved: 8, port: 1, framework: 2, unresolved: 1 });
});

test('wires are exactly the resolved and port sockets', () => {
  assert.strictEqual(model.wires.length, 6);
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

const studs = (id) => brick(id).studs.map((s) => s.name);

test('studs are public methods; private ones are internals; accessors are neither', () => {
  const b = brick(SVC + '#ThingService');
  assert.deepStrictEqual(studs(b.id), ['create', 'find', 'onlyFromInside', 'onModuleInit']);
  assert.deepStrictEqual(b.internals.map((s) => [s.name, s.access]), [['helper', 'private']]);
  assert.ok(!b.studs.concat(b.internals).some((s) => s.name === 'size' || s.name === 'constructor'));
});

test('a static method is a stud marked static', () => {
  const s = brick(SVC + '#ThingService').studs.find((x) => x.name === 'create');
  assert.deepStrictEqual([s.static, s.kind, s.sig], [true, 'method', 'create(): ThingService']);
});

test('arrow-property methods are studs (spec 07 shapes)', () => {
  const [s] = brick('things/domain/services/thing-arrow.service.ts#ThingArrowService').studs;
  assert.deepStrictEqual([s.name, s.async, s.sig], ['load', true, 'load(id: number)']);
});

test('a route handler is a stud carrying its endpoint', () => {
  const [s] = brick(ACTION).studs;
  assert.deepStrictEqual([s.name, s.route], ['execute', 'GET /things/:id#execute']);
});

test('function bricks: exported functions are studs, the rest internals', () => {
  const b = brick('things/domain/utils/date.utils.ts');
  assert.deepStrictEqual(studs(b.id), ['formatDate', 'parseDate', 'isoWeek', 'Audited']);
  assert.deepStrictEqual(b.internals.map((s) => s.name), ['pad']);
  assert.ok(b.studs.every((s) => s.kind === 'function'));
});

test('a hollow port brick offers its interface as declared studs', () => {
  const b = brick('things/domain/ports/thing.port.ts');
  assert.deepStrictEqual(b.studs.map((s) => [s.name, s.kind, s.of]), [['ping', 'declared', 'ThingPort']]);
});

const callsFrom = (id) => model.calls.filter((c) => c.from === id)
  .map((c) => [c.fromMethod, c.to, c.toMethod, !!c.static]);
const UTILS = 'things/domain/utils/date.utils.ts';
const PORT = 'things/domain/ports/thing.port.ts';

test('calls go where the socket goes, through a port to both ends', () => {
  assert.deepStrictEqual(callsFrom(ACTION), [
    ['execute', PORT, 'ping', false],
    ['execute', SVC + '#ThingService', 'find', false],
  ]);
  const viaPort = model.calls.find((c) => c.to === PORT);
  assert.strictEqual(viaPort.boundTo, 'things/apps/adapters/thing.adapter.ts#ThingAdapter');
});

test('calls into a function brick name the calling method; self-calls are not recorded', () => {
  assert.deepStrictEqual(callsFrom(SVC + '#ThingService'), [
    ['find', UTILS, 'formatDate', false],
    ['find', REPO, 'findById', false],
  ]);
  assert.ok(!model.calls.some((c) => c.from === UTILS), 'formatDate -> pad stays inside the brick');
});

test('a static call is recorded with no wire behind it', () => {
  assert.deepStrictEqual(callsFrom(SVC + '#ThingAuditor'), [
    ['audit', UTILS, 'Audited', false],
    ['audit', SVC + '#ThingService', 'create', true],
    ['audit', REPO, 'count', false],
  ]);
  assert.ok(!model.wires.some((w) => w.from === SVC + '#ThingAuditor' && w.to === SVC + '#ThingService'));
});

test('calls through a framework socket are not calls between bricks', () => {
  assert.deepStrictEqual(callsFrom(REPO), []);
});

const grip = (id, name) => brick(id).studs.find((s) => s.name === name).grip;

test('grip: a stud another brick calls is gripped by a brick', () => {
  assert.strictEqual(grip(SVC + '#ThingService', 'find'), 'brick');
  assert.strictEqual(grip(SVC + '#ThingService', 'create'), 'brick', 'a static call grips');
  assert.strictEqual(grip(UTILS, 'formatDate'), 'brick');
});

test('grip: a call through a port grips the port and the class bound to it', () => {
  assert.strictEqual(grip(PORT, 'ping'), 'brick');
  assert.strictEqual(grip('things/apps/adapters/thing.adapter.ts#ThingAdapter', 'ping'), 'brick');
});

test('grip: a route handler nothing calls is gripped by its route', () => {
  assert.strictEqual(grip(ACTION, 'execute'), 'route');
});

test('grip: a public method called only from inside its class is unseen', () => {
  assert.strictEqual(grip(SVC + '#ThingService', 'onlyFromInside'), 'unseen');
  assert.strictEqual(grip(UTILS, 'isoWeek'), 'unseen');
});

test('wiringMeta counts studs by grip', () => {
  assert.deepStrictEqual(model.wiringMeta.studs, { total: 17, brick: 9, route: 1, framework: 1, unseen: 6 });
});

test('grip: a method Nest calls is gripped by the framework, and says why', () => {
  const s = brick(SVC + '#ThingService').studs.find((x) => x.name === 'onModuleInit');
  assert.deepStrictEqual([s.grip, s.framework], ['framework', 'lifecycle']);
});

test('a decorator\'s arguments are a call from the member it decorates', () => {
  assert.strictEqual(grip(UTILS, 'Audited'), 'brick');
  const c = model.calls.find((x) => x.toMethod === 'Audited');
  assert.deepStrictEqual([c.from, c.fromMethod], [SVC + '#ThingAuditor', 'audit']);
});

test('a script (main.ts) is a brick with no studs, so its calls are recorded', () => {
  const b = brick('main.ts');
  assert.deepStrictEqual([b.shape, b.studs.length, b.internals.map((s) => s.name)], ['script', 0, ['bootstrap']]);
  assert.deepStrictEqual(callsFrom('main.ts'), [['bootstrap', UTILS, 'formatDate', false]]);
});

test('a class injecting another declared in the same file resolves, and the call is recorded', () => {
  const P = 'things/domain/services/pair.service.ts';
  assert.deepStrictEqual(sockets(P + '#PairSecond'), [['first', 'resolved', P + '#PairFirst']]);
  assert.deepStrictEqual(callsFrom(P + '#PairSecond'), [['go', P + '#PairFirst', 'run', false]]);
});

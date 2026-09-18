'use strict';
/**
 * Spec 07 — traces run through arrow-function properties, and every
 * mid-trace stop is a trace-stalled diagnostic.
 * See docs/specs/07-arrow-trace-resolution.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const model = scan(Object.assign({}, nestjs, {
  name: 'arrows', root: '.',
  __dir: path.join(__dirname, 'fixtures', 'arrows'),
}));

const ep = (route) => model.endpoints.find((e) => e.route === route);
const flat = (route) => ep(route).flat;
const stalls = model.diagnostics.filter((d) => d.kind === 'trace-stalled');
const stall = (file, method) => stalls.filter((d) => d.file === file && d.method === method);

test('an async arrow property traces to the repository layer', () => {
  assert.deepStrictEqual(flat('/meets/start').map((h) => [h.kind, h.method, h.depth]), [
    ['service', 'startMeet', 1],
    ['transaction-script', 'apply', 2],
    ['repository', 'save', 3],
  ]);
});

test('a plain arrow property traces to the repository layer', () => {
  assert.deepStrictEqual(flat('/meets/:id').map((h) => [h.kind, h.method, h.depth]), [
    ['service', 'findOne', 1],
    ['repository', 'findById', 2],
  ]);
});

test('a private arrow property traces', () => {
  assert.deepStrictEqual(flat('/meets/cost').map((h) => [h.kind, h.method, h.depth]), [
    ['service', 'calculateCost', 1],
    ['repository', 'findById', 2],
  ]);
});

test('an unaccepted shape stalls with body-not-found', () => {
  assert.deepStrictEqual(flat('/meets/lazy').map((h) => [h.kind, h.method, h.depth]), [
    ['service', 'helper', 1],
  ]);
  const d = stall('meet/domain/services/meet.service.ts', 'helper');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].reason, 'body-not-found');
  assert.strictEqual(d[0].depth, 1);
});

test('a this.x on a class field stalls with dep-not-injected, and the trace continues', () => {
  const d = stall('meet/domain/services/meet.service.ts', 'findOne');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].reason, 'dep-not-injected');
  assert.ok(flat('/meets/:id').some((h) => h.method === 'findById'));
});

test('the depth cap stalls with depth-cap, and the next layer is absent', () => {
  const f = flat('/deep');
  assert.deepStrictEqual(f.map((h) => [h.method, h.depth]), [
    ['deep', 1], ['deep', 2], ['deep', 3], ['deep', 4], ['deep', 5], ['deep', 6],
  ]);
  assert.ok(!f.some((h) => h.file.endsWith('g.service.ts')));
  const d = stall('deep/f.service.ts', 'deep');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].reason, 'depth-cap');
  assert.strictEqual(d[0].depth, 6);
});

test('no other stalls on the fixture', () => {
  assert.strictEqual(stalls.length, 3);
});

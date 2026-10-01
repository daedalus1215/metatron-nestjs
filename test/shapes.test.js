'use strict';
/**
 * Spec 15 — reading a type expression into a shape: fields and optionality,
 * arrays, nothing; anything else unread.
 */
const test = require('node:test');
const assert = require('node:assert');
const { shapeOf } = require('../src/shapes');

const keys = (s) => Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.optional]));

test('an object literal type: fields, optional marks, index signatures open it', () => {
  assert.deepStrictEqual(keys(shapeOf('{ name: string; parentId?: number | null }')), { name: false, parentId: true });
  assert.strictEqual(shapeOf('{ id: number; [k: string]: unknown }').open, true);
  assert.deepStrictEqual(keys(shapeOf('{ a: Map<string, number>, b?: { c: string } }')), { a: false, b: true });
});

test('Promise unwraps; void and friends are nothing', () => {
  assert.deepStrictEqual(keys(shapeOf('Promise<{ success: boolean }>')), { success: false });
  assert.deepStrictEqual(shapeOf('Promise<void>'), { none: true });
  assert.deepStrictEqual(shapeOf('undefined'), { none: true });
});

test('arrays: T[] and Array<T>', () => {
  assert.deepStrictEqual(keys(shapeOf('{ id: number }[]').array), { id: false });
  assert.deepStrictEqual(keys(shapeOf('Array<{ id: number }>').array), { id: false });
  assert.deepStrictEqual(shapeOf('Promise<Unknown[]>'), { array: null });
});

test('Partial makes every field optional; & merges; T | null is T', () => {
  assert.deepStrictEqual(keys(shapeOf('Partial<{ a: string; b: number }>')), { a: true, b: true });
  assert.deepStrictEqual(keys(shapeOf('{ a: string } & { b?: number }')), { a: false, b: true });
  assert.deepStrictEqual(keys(shapeOf('{ a: string } | null')), { a: false });
});

test('names go through the lookup; what cannot be read is null', () => {
  const lookup = (n) => (n === 'Thing' ? { fields: { id: { optional: false, type: 'number' } }, open: false } : null);
  assert.deepStrictEqual(keys(shapeOf('Promise<Thing[]>', lookup).array), { id: false });
  assert.strictEqual(shapeOf('Nope', lookup), null);
  assert.strictEqual(shapeOf('string | number'), null, 'a real union');
  assert.strictEqual(shapeOf('Record<string, Thing>', lookup), null, 'a generic of our own');
  assert.strictEqual(shapeOf('T extends U ? X : Y'), null);
});

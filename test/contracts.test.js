'use strict';
/**
 * Spec 15 — comparing the two sides' declared shapes.
 */
const test = require('node:test');
const assert = require('node:assert');
const { compareRequest, compareResponse } = require('../src/contracts');
const { shapeOf } = require('../src/shapes');

const S = (t) => shapeOf(t);
const DTO = S('{ name: string; description?: string; folderId: number }');

test('request: a literal that sends what the DTO requires agrees', () => {
  assert.deepStrictEqual(compareRequest({ literal: ['name', 'folderId'], open: false }, DTO), { status: 'agree' });
});

test('request: a key the DTO does not declare, a required field not sent', () => {
  assert.deepStrictEqual(compareRequest({ literal: ['name', 'colour'], open: false }, DTO),
    { status: 'differ', extra: ['colour'], missing: ['folderId'], optional: [] });
});

test('request: a spread opens a literal — what is missing cannot be said', () => {
  assert.deepStrictEqual(compareRequest({ literal: ['name'], open: true }, DTO), { status: 'agree' });
});

test('request: a named type that makes a required field optional', () => {
  assert.deepStrictEqual(compareRequest(S('{ name: string; folderId?: number }'), DTO),
    { status: 'differ', extra: [], missing: [], optional: ['folderId'] });
});

test('request: bodies on one side only', () => {
  assert.deepStrictEqual(compareRequest({ none: true }, { none: true }), { status: 'agree' });
  assert.strictEqual(compareRequest({ literal: ['a'], open: false }, { none: true }).status, 'differ');
  assert.deepStrictEqual(compareRequest({ none: true }, DTO).missing, ['name', 'folderId']);
  assert.deepStrictEqual(compareRequest({ none: true }, S('{ a?: string }')), { status: 'agree' });
  assert.strictEqual(compareRequest(null, DTO).status, 'unread');
});

test('response: what the frontend requires must be declared; extras are fine', () => {
  const Note = S('{ id: number; name: string; pinned: boolean; tags?: string[] }');
  assert.deepStrictEqual(compareResponse(Note, S('{ id: number; name: string }')), { status: 'differ', missing: ['pinned'] });
  assert.deepStrictEqual(compareResponse(S('{ id: number }'), S('{ id: number; name: string }')), { status: 'agree' });
});

test('response: arrays, nothing, and what cannot be read', () => {
  assert.strictEqual(compareResponse(S('{ id: number }[]'), S('{ id: number }')).status, 'differ');
  assert.deepStrictEqual(compareResponse(S('{ id: number }[]'), S('Promise<{ id: number; x: string }[]>')), { status: 'agree' });
  assert.match(compareResponse(S('{ id: number }'), S('Promise<void>')).why, /returns nothing/);
  assert.deepStrictEqual(compareResponse(S('void'), S('{ id: number }')), { status: 'agree' });
  assert.strictEqual(compareResponse(null, S('{ id: number }')).status, 'unread');
});

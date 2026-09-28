'use strict';
/**
 * Spec 12 — the bridge: every HTTP call a frontend makes, matched to the
 * backend endpoint it reaches, or reported.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const { load } = require('../src/config');
const { segmentsOf, score } = require('../src/bridge');

const model = scan(load(path.join(__dirname, 'fixtures', 'react')));
const http = Object.fromEntries(model.calls.filter((c) => c.kind === 'http').map((c) => [c.fromMethod, c]));

test('a template, an explicit prefix, a URL in a const, a query: all matched', () => {
  assert.deepStrictEqual(
    ['fetchThing', 'deleteThing', 'renameThing', 'fetchThings', 'fetchName'].map((n) => [n, http[n].match, http[n].endpoint]),
    [['fetchThing', 'matched', 'GET /things/:id#execute'],
      ['deleteThing', 'matched', 'DELETE /things/:id#execute'],
      ['renameThing', 'matched', 'PATCH /things/:id/name#execute'],
      ['fetchThings', 'matched', 'GET /things#execute'],
      ['fetchName', 'matched', 'GET /things/:id/name#execute']]);
  assert.strictEqual(http.fetchThing.endpointBrick, 'things/apps/actions/get-thing.action.ts#GetThingAction');
  assert.strictEqual(http.fetchThing.endpointMethod, 'execute');
});

test('the stud carries the match too', () => {
  const b = model.bricks.find((x) => x.id === 'api/requests/things.requests.ts');
  const s = b.studs.find((x) => x.name === 'fetchThing');
  assert.deepStrictEqual([s.http[0].match, s.http[0].endpoint], ['matched', 'GET /things/:id#execute']);
});

test('ambiguous, unmatched and unread are reported, never guessed', () => {
  assert.deepStrictEqual([http.fetchView.match, http.fetchView.candidates],
    ['ambiguous', ['GET /views/archived#archived', 'GET /views/recent#recent']]);
  assert.strictEqual(http.pingMissing.match, 'unmatched');
  assert.strictEqual(http.fetchBuilt.match, 'unread');
  const kinds = model.diagnostics.map((d) => d.kind);
  for (const k of ['http-ambiguous', 'http-unmatched', 'http-unread']) assert.ok(kinds.includes(k), k);
});

test('the summary: calls by outcome, and the endpoints no call reaches', () => {
  const B = model.bridge;
  assert.deepStrictEqual([B.backend, B.calls, B.matched, B.ambiguous, B.unmatched, B.unread, B.endpoints, B.reached],
    ['../react-backend', 8, 5, 1, 1, 1, 8, 5]);
  assert.deepStrictEqual(B.unreached, ['POST /things#execute', 'GET /views/archived#archived', 'GET /views/recent#recent']);
});

test('a hole prefers a param; a literal prefers an equal literal', () => {
  const u = segmentsOf('/things/${id}', null);
  assert.ok(score(u, ['things', ':id']) > score(u, ['things', 'archived']));
  const lit = segmentsOf('/api/things/search?q=1', '/api');
  assert.deepStrictEqual(lit, ['things', 'search']);
  assert.ok(score(lit, ['things', 'search']) > score(lit, ['things', ':id']));
});

test('a backend that cannot be loaded is a diagnostic, not a failed scan', () => {
  const cfg = load(path.join(__dirname, 'fixtures', 'react'));
  cfg.backend = '../does-not-exist';
  const m = scan(cfg);
  assert.match(m.bridge.error, /No arch\.config\.js/);
  assert.ok(m.diagnostics.some((d) => d.kind === 'backend-unavailable'));
});

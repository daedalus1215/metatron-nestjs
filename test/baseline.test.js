'use strict';
/**
 * Spec 02 — the ratchet. See specs/02-violation-baseline-and-check.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const BL = require('../src/baseline');
const { violationsOf, ungated, fingerprint } = require('../src/violations');

const FIXTURE = path.join(__dirname, 'fixtures', 'baseline');
// The baseline is written next to the config, so give each test its own dir
// rather than dropping arch.baseline.json into this repo.
const tmpCfg = () => Object.assign({}, nestjs, {
  name: 'fx', root: FIXTURE,
  __dir: fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-')),
  __file: 'arch.config.js',
});

const model = scan(tmpCfg());

test('violations are extracted from warn findings', () => {
  const rules = model.violations.map((v) => v.rule).sort();
  assert.deepStrictEqual(rules, ['action>repository', 'naming-ts-suffix', 'orphans']);
});

test('a skip that jumps two stations is critical', () => {
  const v = model.violations.find((x) => x.rule === 'action>repository');
  assert.strictEqual(v.sev, 'crit');
  assert.ok(v.from.endsWith('create-note.action.ts'));
  assert.ok(v.to.endsWith('note.repository.ts'));
});

test('two rules on one file produce two distinct fingerprints', () => {
  const same = model.violations.filter((v) => v.from.endsWith('unused.transaction-script.ts'));
  assert.strictEqual(same.length, 2);
  assert.notStrictEqual(same[0].fingerprint, same[1].fingerprint);
});

test('fingerprints are stable across runs', () => {
  const again = scan(tmpCfg());
  assert.deepStrictEqual(
    again.violations.map((v) => v.fingerprint).sort(),
    model.violations.map((v) => v.fingerprint).sort());
});

test('aggregate findings never become gateable violations', () => {
  // `dag` and `app-apps` report totals about the tree; ratcheting them is meaningless.
  const aggregate = model.findings.filter((f) => f.gate === false).map((f) => f.id);
  assert.ok(aggregate.includes('dag'));
  for (const id of aggregate) {
    assert.ok(!model.violations.some((v) => v.rule === id), `${id} leaked into violations`);
  }
  assert.ok(Array.isArray(ungated(model)));
});

test('write then check is clean', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const r = BL.compare(model, BL.read(cfg));
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.fixed.length, 0);
  assert.strictEqual(r.unchanged, 3);
});

test('baseline refuses to invent a violations object', () => {
  const cfg = tmpCfg();
  fs.writeFileSync(BL.fileFor(cfg), '{"version":1}');
  assert.throws(() => BL.read(cfg), /no "violations" object/);
  fs.writeFileSync(BL.fileFor(cfg), 'not json');
  assert.throws(() => BL.read(cfg), /not valid JSON/);
});

test('a violation absent from the baseline is named as new', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const doc = BL.read(cfg);
  const target = model.violations.find((v) => v.rule === 'action>repository');
  delete doc.violations[target.fingerprint];
  const r = BL.compare(model, doc);
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.added[0].rule, 'action>repository');
  assert.ok(r.added[0].from.endsWith('create-note.action.ts'), 'must name the offender');
});

test('a baselined violation that is gone is reported as fixed', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const doc = BL.read(cfg);
  doc.violations[fingerprint('orphans', 'gone/away.ts', '')] =
    { rule: 'orphans', from: 'gone/away.ts', to: '' };
  const r = BL.compare(model, doc);
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.fixed.length, 1);
  assert.strictEqual(r.fixed[0].from, 'gone/away.ts');
});

test('--rule scopes the gate without hiding the rest', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const doc = BL.read(cfg);
  for (const v of model.violations) delete doc.violations[v.fingerprint];
  const r = BL.compare(model, doc, ['orphans']);
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.added[0].rule, 'orphans');
  assert.strictEqual(r.addedOutOfScope.length, 2, 'still reported, just not gated');
});

test('hand-written notes survive an update', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const doc = BL.read(cfg);
  const fp = model.violations[0].fingerprint;
  doc.violations[fp].note = 'legacy, pre-dates the aggregator';
  fs.writeFileSync(BL.fileFor(cfg), JSON.stringify(doc, null, 2));

  const prev = BL.read(cfg);
  const r = BL.write(cfg, model, prev);
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(BL.read(cfg).violations[fp].note, 'legacy, pre-dates the aggregator');
});

test('comparing never mutates the baseline on disk', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const before = fs.readFileSync(BL.fileFor(cfg), 'utf8');
  const doc = BL.read(cfg);
  doc.violations[fingerprint('orphans', 'gone/away.ts', '')] =
    { rule: 'orphans', from: 'gone/away.ts', to: '' };
  BL.compare(model, doc);
  assert.strictEqual(fs.readFileSync(BL.fileFor(cfg), 'utf8'), before,
    'a fixed violation must not be retired without --update');
});

test('a note whose violation is gone is dropped, and counted honestly', () => {
  const cfg = tmpCfg();
  BL.write(cfg, model, null);
  const doc = BL.read(cfg);
  doc.violations[fingerprint('orphans', 'gone/away.ts', '')] =
    { rule: 'orphans', from: 'gone/away.ts', to: '', note: 'scheduled for removal' };
  const live = model.violations[0].fingerprint;
  doc.violations[live].note = 'legacy';

  const r = BL.write(cfg, model, doc);
  assert.strictEqual(r.kept, 1, 'the live note is carried over');
  assert.strictEqual(r.dropped, 1, 'the stale note is reported, not counted as preserved');
  assert.ok(!BL.read(cfg).violations[fingerprint('orphans', 'gone/away.ts', '')]);
});

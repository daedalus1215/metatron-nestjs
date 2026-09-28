'use strict';
/**
 * Spec 06 — test presence crossed with risk, with a self-check that suppresses
 * the findings when the locator does not fit the project. See
 * specs/06-test-coverage-crossing.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'tests');

function scanFixture(overrides = {}) {
  return scan(Object.assign({}, nestjs, {
    name: 'fixture', root: '.', __dir: FIXTURE, ...overrides,
  }));
}

const model = scanFixture();

test('every spec file is classified as spec', () => {
  assert.strictEqual(model.tests.meta.specFiles, 4);
});

test('__specs__ subdirectory locator wins', () => {
  assert.strictEqual(
    model.tests.bySource['notes/domain/services/note.service.ts'],
    'notes/domain/services/__specs__/note.service.spec.ts');
});

test('sibling locator is the fallback', () => {
  assert.strictEqual(
    model.tests.bySource['notes/infra/repositories/note.repository.ts'],
    'notes/infra/repositories/note.repository.spec.ts');
});

test('a source with no test maps to null', () => {
  assert.strictEqual(model.tests.bySource['notes/domain/aggregators/note.aggregator.ts'], null);
});

test('reverse check: one source per spec, the orphan listed', () => {
  assert.deepStrictEqual(model.tests.unmatchedSpecs,
    ['notes/infra/repositories/orphan.spec.ts']);
  assert.strictEqual(model.tests.meta.matched, 3);
  assert.strictEqual(model.tests.meta.strategy, 'index 0');
  assert.strictEqual(model.tests.meta.reliable, true);
});

test('byPattern reports presence per pattern', () => {
  assert.deepStrictEqual(model.tests.byPattern.aggregator, { total: 1, tested: 0 });
  assert.deepStrictEqual(model.tests.byPattern.service, { total: 1, tested: 1 });
  assert.deepStrictEqual(model.tests.byPattern.repository, { total: 1, tested: 1 });
});

test('a reliable model carries the test-ratio finding', () => {
  const f = model.findings.find((x) => x.id === 'test-ratio');
  assert.ok(f, 'test-ratio finding present');
  assert.strictEqual(f.tone, 'note');
  assert.ok(f.items.includes('aggregator 0/1'), 'the untested layer is named');
  assert.match(f.detail, /presence, not quality/);
});

test('a locator that fits nothing suppresses the findings', () => {
  const m = scanFixture({ testLocators: [(rel) => rel + '.does-not-exist.ts'] });
  assert.strictEqual(m.tests.meta.reliable, false);
  assert.strictEqual(m.tests.unmatchedSpecs.length, 4);
  assert.ok(!m.findings.some((x) => x.id === 'test-ratio'));
  assert.ok(!m.findings.some((x) => x.id === 'untested-risk'));
});

test('one spec claimed by every source is not a match', () => {
  const m = scanFixture({ testLocators: [(rel) => 'notes/infra/repositories/orphan.spec.ts'] });
  assert.strictEqual(m.tests.meta.reliable, false);
  assert.strictEqual(m.tests.unmatchedSpecs.length, 4,
    'the over-claimed spec and the three it displaced are all unmatched');
  assert.ok(!m.findings.some((x) => x.id === 'untested-risk'));
});

test('a project with no spec files is reliable at zero coverage', () => {
  const m = scan(Object.assign({}, nestjs, {
    name: 'fixture', root: '.', __dir: path.join(__dirname, 'fixtures', 'ports'),
  }));
  assert.strictEqual(m.tests.meta.specFiles, 0);
  assert.strictEqual(m.tests.meta.reliable, true);
  assert.strictEqual(m.tests.meta.strategy, 'none');
  assert.ok(Object.values(m.tests.bySource).every((v) => v === null));
});

test('the ranked finding uses the hotspots score over real git history', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-tests-'));
  try {
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    const git = (a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(a),
      { cwd: tmp, stdio: 'pipe' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);
    // two more commits touch only the aggregator: 3 commits, 1 dependent
    for (let i = 0; i < 2; i++) {
      fs.appendFileSync(path.join(tmp, 'notes', 'domain', 'aggregators', 'note.aggregator.ts'), '\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'churn ' + i]);
    }
    const m = scan(Object.assign({}, nestjs, { name: 'fixture', root: '.', __dir: tmp }));
    assert.strictEqual(m.churnMeta.available, true);
    const f = m.findings.find((x) => x.id === 'untested-risk');
    assert.ok(f, 'untested-risk finding present');
    assert.strictEqual(f.title, '2 high-risk files have no test');
    // The churned aggregator ranks above the module: score 6 vs 1.
    assert.deepStrictEqual(f.items, [
      'notes/domain/aggregators/note.aggregator.ts — 3 commits, 1 dependents, no test',
      'notes/notes.module.ts — 1 commits, 0 dependents, no test',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

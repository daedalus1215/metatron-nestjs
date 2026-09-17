'use strict';
/**
 * Spec 03 — logical coupling: co-change crossed against the import graph.
 * See specs/03-logical-coupling.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'coupling');

const S = 'notes/domain/services/note.service.ts';
const H = 'time-tracks/domain/aggregators/track.helper.aggregator.ts';
const TE = 'time-tracks/domain/entities/track.entity.ts';
const TS = 'time-tracks/domain/services/track.service.ts';

/**
 * The fixture files are paired by design, and the history below is built to
 * make each guard fire exactly once. The baseline commit touches every file,
 * so it adds one co-occurrence to every pair and one change to every file:
 *
 *   S ~ H       5 shared of 6 changes each, no import edge  -> 5/7, unexplained
 *   TE ~ TS     6 of 6, and TS imports TE                   -> 1.0, explained
 *   tags/*      4 changes each, under the support floor     -> excluded
 *   audio/*     6 changes each but only 2 shared commits    -> 0.2 < 0.3
 *   sweep       one commit touching 28 files                -> ignored
 *
 * If the sweep commit were (wrongly) counted, S ~ H would read 6 of 8 = 0.75
 * instead of 5/7, so the exact-value assertions double as the guard check.
 */
function withHistory(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-coupling-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const git = (a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(a),
    { cwd: tmp, stdio: 'pipe' });
  const touch = (files, n) => {
    for (const f of files) fs.appendFileSync(path.join(tmp, f), '\n// ' + n + '\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'c' + n]);
  };
  try {
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    touch(['notes/notes.module.ts', 'notes/domain/entities/note.entity.ts', S], 1);
    for (let n = 2; n <= 5; n++) touch([S, H], n);
    touch([H], 6);
    for (let n = 7; n <= 11; n++) touch([TE, TS], n);
    for (let n = 12; n <= 14; n++) touch(['tags/tag.service.ts', 'tags/tag.entity.ts'], n);
    touch(['audio/audio.service.ts', 'audio/audio.entity.ts'], 15);
    for (let n = 16; n <= 19; n++) touch(['audio/audio.service.ts'], n);
    for (let n = 20; n <= 23; n++) touch(['audio/audio.entity.ts'], n);
    touch(['time-tracks/time-tracks.module.ts'], 24);
    // 26 generated files + S + H = 28 files, over the cap of 25.
    const sweep = [];
    fs.mkdirSync(path.join(tmp, 'sweep'), { recursive: true });
    for (let i = 1; i <= 26; i++) {
      const f = 'sweep/x' + String(i).padStart(2, '0') + '.ts';
      fs.writeFileSync(path.join(tmp, f), 'export const x = ' + i + ';\n');
      sweep.push(f);
    }
    touch(sweep.concat([S, H]), 26);
    return scan(Object.assign({}, nestjs, { name: 'fixture', root: '.', __dir: tmp, ...overrides }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('exactly the intended pairs survive the guards, with exact Jaccard values', () => {
  const m = withHistory();
  assert.strictEqual(m.coupling.pairs.length, 2);
  assert.deepStrictEqual(m.coupling.pairs, [
    { a: TE, b: TS, co: 6, changesA: 6, changesB: 6, degree: 1, aThenB: 1, bThenA: 1, imports: 1 },
    { a: S, b: H, co: 5, changesA: 6, changesB: 6, degree: 0.714, aThenB: 0.833, bThenA: 0.833, imports: 0 },
  ]);
});

test('meta counts the ignored sweep commit and the eligible files', () => {
  const m = withHistory();
  assert.deepStrictEqual(m.coupling.meta, {
    commits: 26, excludedCommits: 1, eligibleFiles: 6,
    maxFiles: 25, minChanges: 5, minDegree: 0.3, reason: null,
  });
  assert.deepStrictEqual(m.coupling.eligible.slice().sort(),
    [S, H, TE, TS, 'audio/audio.service.ts', 'audio/audio.entity.ts'].sort());
});

test('the import graph explains the track pair and not the helper pair', () => {
  const m = withHistory();
  const p1 = m.coupling.pairs.find((p) => p.a === S);
  const p2 = m.coupling.pairs.find((p) => p.a === TE);
  assert.strictEqual(p1.imports, 0);
  assert.strictEqual(p2.imports, 1);
  // aThenB is the asymmetric reading: the helper drags the service along 83%
  // of the time it moves, and the entity always moves with its service.
  assert.strictEqual(p1.aThenB, 0.833);
  assert.strictEqual(p2.bThenA, 1);
});

test('the finding names the cross-module pair without an import edge', () => {
  const m = withHistory();
  const f = m.findings.find((x) => x.id === 'logical-coupling');
  assert.ok(f, 'logical-coupling finding present');
  assert.strictEqual(f.title, 'Files that change together but do not reference each other');
  assert.strictEqual(f.detail,
    'Across 26 commits (1 ignored for touching more than 25 files), 1 pair co-changes above 60% with no import edge between them. Usually a duplicated rule or a missing abstraction.');
  assert.deepStrictEqual(f.items, [
    S + '  ~  ' + H + '   (5 of 7, 71%)',
  ]);
});

test('couplingMaxFiles below the commit size excludes everything pairable', () => {
  const m = withHistory({ couplingMaxFiles: 1 });
  // 16 commits touch more than one file; the rest are single-file commits.
  assert.strictEqual(m.coupling.meta.excludedCommits, 16);
  assert.strictEqual(m.coupling.pairs.length, 0);
});

test('a project without git history degrades the way churn does', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-coupling-'));
  try {
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    const m = scan(Object.assign({}, nestjs, { name: 'fixture', root: '.', __dir: tmp }));
    assert.strictEqual(m.churnMeta.available, false);
    assert.strictEqual(m.coupling.meta.reason, m.churnMeta.reason);
    assert.deepStrictEqual(m.coupling.pairs, []);
    assert.deepStrictEqual(m.coupling.eligible, []);
    assert.strictEqual(m.findings.find((x) => x.id === 'logical-coupling'), undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

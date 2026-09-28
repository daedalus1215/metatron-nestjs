'use strict';
/**
 * Spec 11 — the change overlay against a real (temporary) git repository:
 * frames, a head read from git objects rather than the working tree, and
 * the refusal when a PR's head commit is not local.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const nestjs = require('../src/defaults/nestjs');
const { resolveChange, changeAt } = require('../src/change');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-change-'));
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
  { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// The config sits in backend/, below the repository root — as in a repo with
// a backend/ beside a frontend/. Git pathspecs are root-relative; a command
// run from backend/ with one silently matches nothing.
const SRC = path.join(dir, 'backend', 'src');
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(SRC, rel)), { recursive: true });
  fs.writeFileSync(path.join(SRC, rel), text);
};
const svc = (name, deps = [], body = 'return 1;') => `import { Injectable } from '@nestjs/common';
${deps.map(([cls, file]) => `import { ${cls} } from '${file}';`).join('\n')}

@Injectable()
export class ${name} {
  constructor(${deps.map(([cls]) => `private readonly ${cls[0].toLowerCase() + cls.slice(1)}: ${cls}`).join(', ')}) {}

  run() {
    ${body}
  }
}
`;

const REPO = 'repo/a.repository.ts';
const NEW = 'feature/new.service.ts';
const USE = 'feature/user.service.ts';

let base, c1, c2;
test.before(() => {
  git('init', '-q', '-b', 'main');
  write(REPO, svc('ARepository'));
  git('add', '.'); git('commit', '-q', '-m', 'base');
  base = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'feat');
  write(NEW, svc('NewService', [['ARepository', '../repo/a.repository']], 'return this.aRepository.run();'));
  git('add', '.'); git('commit', '-q', '-m', 'add NewService');
  c1 = git('rev-parse', 'HEAD');
  write(USE, svc('UserService', [['NewService', './new.service']], 'return this.newService.run();'));
  git('add', '.'); git('commit', '-q', '-m', 'add UserService');
  c2 = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  // A branch that only moves a file.
  git('checkout', '-q', '-b', 'moves');
  fs.mkdirSync(path.join(SRC, 'repo', 'moved'));
  git('mv', 'backend/src/' + REPO, 'backend/src/repo/moved/a.repository.ts');
  git('commit', '-q', '-m', 'move the repository');
  git('checkout', '-q', 'main');
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const cfg = () => Object.assign({}, nestjs, { name: 'g', root: 'src', __dir: path.join(dir, 'backend') });
const id = (rel, cls) => rel + '#' + cls;

test('a range resolves to its merge base, its head commit, and first-parent frames', () => {
  const r = resolveChange(cfg(), { range: 'main...feat' });
  assert.deepStrictEqual([r.base, r.head], [base, c2]);
  assert.deepStrictEqual(r.frames.map((f) => [f.sha, f.subject]),
    [[base, '(base)'], [c1, 'add NewService'], [c2, 'add UserService']]);
});

test('the head is read from git objects, not the working tree', () => {
  // main is checked out: neither feature file exists on disk.
  assert.ok(!fs.existsSync(path.join(SRC, NEW)));
  const { change, model } = changeAt(cfg(), { range: 'main...feat' });
  assert.strictEqual(change.bricks[id(NEW, 'NewService')], 'added');
  assert.strictEqual(change.bricks[id(USE, 'UserService')], 'added');
  assert.ok(model.__text[NEW].includes('class NewService'));
  assert.deepStrictEqual(change.summary.attachments.map((a) => [a.brick, a.with]),
    [[id(REPO, 'ARepository'), [id(NEW, 'NewService')]]]);
  assert.strictEqual(change.summary.territory, 1);
});

test('frames replay the range: each compares the base with that commit', () => {
  const f1 = changeAt(cfg(), { range: 'main...feat' }, { frame: 1 }).change;
  assert.strictEqual(f1.rev, c1);
  assert.strictEqual(f1.bricks[id(USE, 'UserService')], undefined);
  assert.strictEqual(f1.summary.added, 1);
  const f0 = changeAt(cfg(), { range: 'main...feat' }, { frame: 0 }).change;
  assert.strictEqual(f0.summary.added, 0);
  assert.deepStrictEqual(f0.pairs, []);
});

test('work in progress compares with the working tree, and adds an uncommitted frame', () => {
  git('checkout', '-q', 'feat');
  try {
    write('feature/draft.service.ts', svc('DraftService', [['UserService', './user.service']], 'return this.userService.run();'));
    const { change } = changeAt(cfg(), {});
    assert.strictEqual(change.frames.at(-1).subject, '(uncommitted)');
    assert.strictEqual(change.rev, null);
    assert.strictEqual(change.bricks[id('feature/draft.service.ts', 'DraftService')], 'added');
  } finally {
    fs.rmSync(path.join(SRC, 'feature', 'draft.service.ts'));
    git('checkout', '-q', 'main');
  }
});

test('a PR whose head commit is not local is refused with the fetch to run', () => {
  const gh = () => ({ baseRefOid: base, headRefOid: 'f'.repeat(40), title: 'x' });
  assert.throws(() => resolveChange(cfg(), { pr: '12' }, { gh }), /not in this repository[\s\S]*git fetch origin pull\/12\/head/);
});

test('a PR that is local resolves like a range', () => {
  const gh = () => ({ baseRefOid: base, headRefOid: c2, title: 'Add the feature' });
  const r = resolveChange(cfg(), { pr: '#12' }, { gh });
  assert.deepStrictEqual([r.base, r.head, r.label], [base, c2, '#12 Add the feature']);
});

test('a moved file is a rename, not a removal plus an addition', () => {
  const { change } = changeAt(cfg(), { range: 'main...moves' });
  assert.deepStrictEqual(change.removed, []);
  assert.strictEqual(change.bricks[id('repo/moved/a.repository.ts', 'ARepository')], 'unchanged');
  assert.strictEqual(change.summary.added, 0);
});

test('the workbench serves a removed brick, and its source at the base', async () => {
  const { createWorkbench } = require('../src/serve');
  git('checkout', '-q', '-b', 'trim', 'feat');
  git('rm', '-q', 'backend/src/' + USE);
  git('commit', '-q', '-m', 'drop UserService');
  git('checkout', '-q', 'main');
  const wb = createWorkbench(cfg(), { watch: false, log: () => {} });
  const url = await wb.listen(0);
  try {
    const d = await (await fetch(url + 'api/change?range=feat...trim')).json();
    assert.deepStrictEqual(d.change.removed.map((b) => [b.id, b.studs.map((s) => s.name)]),
      [[id(USE, 'UserService'), ['run']]]);
    assert.ok(d.change.pairs.some((p) => p.class === 'detached' && p.from === id(USE, 'UserService')));
    const src = await fetch(url + 'api/source?file=' + encodeURIComponent(USE) + '&rev=' + d.change.base);
    assert.strictEqual(src.status, 200);
    assert.match(await src.text(), /class UserService/);
  } finally {
    await wb.close();
  }
});

// ---------------------------------------------------------------- commit sets
// A branch of three independent additions and one edit that needs the
// second: pick1 adds P1, pick2 adds P2, pick3 adds P3, pick4 edits P2.
let p1, p2, p3, p4;
const P = (n) => `picks/p${n}.service.ts`;
const objectCount = () => git('count-objects', '-v');
test('commit sets: setup', () => {
  git('checkout', '-q', '-b', 'picks', 'main');
  const add = (n) => { write(P(n), svc(`P${n}Service`)); git('add', '.'); git('commit', '-q', '-m', `add P${n}`); return git('rev-parse', 'HEAD'); };
  p1 = add(1); p2 = add(2); p3 = add(3);
  write(P(2), svc('P2Service', [], 'return 2;'));
  git('add', '.'); git('commit', '-q', '-m', 'edit P2');
  p4 = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
});

test('a set that skips a commit is built from the base plus exactly those commits', () => {
  const before = objectCount();
  const { change, model } = changeAt(cfg(), { commits: [p3, p1] });          // any order
  assert.deepStrictEqual(change.frames.map((f) => [f.sha, f.built]), [[base, false], [p1, false], [p3, true]]);
  assert.strictEqual(change.base, base);
  assert.deepStrictEqual(Object.keys(change.bricks).filter((k) => change.bricks[k] === 'added').sort(),
    [id(P(1), 'P1Service'), id(P(3), 'P3Service')]);
  assert.ok(!model.bricks.some((b) => b.name === 'P2Service'), 'the skipped commit is not in the head');
  assert.match(change.rev, /^set-[0-9a-f]{16}$/);
  assert.strictEqual(objectCount(), before, 'nothing was written to the repository');
});

test('an unbroken chain uses the commits themselves', () => {
  const { change } = changeAt(cfg(), { commits: `${p1},${p2}` });
  assert.deepStrictEqual(change.frames.map((f) => f.built), [false, false, false]);
  assert.strictEqual(change.rev, p2);
});

test('one commit is shown against its parent', () => {
  const { change } = changeAt(cfg(), { commits: p2 });
  assert.strictEqual(change.base, p1);
  assert.deepStrictEqual(Object.keys(change.bricks).filter((k) => change.bricks[k] === 'added'), [id(P(2), 'P2Service')]);
  assert.match(change.label, /^[0-9a-f]{7} add P2$/);
});

test('a commit that needs one left out of the set is refused, by name', () => {
  assert.throws(() => changeAt(cfg(), { commits: [p1, p4] }),
    /[0-9a-f]{7} "edit P2" does not apply without commits left out of the set/);
  // The frames before it still work.
  assert.strictEqual(changeAt(cfg(), { commits: [p1, p4] }, { frame: 1 }).change.summary.added, 1);
});

test('a frontend change reads its .tsx files from git', () => {
  const fdir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-fe-change-'));
  try {
    fs.cpSync(path.join(__dirname, 'fixtures', 'react', 'src'), path.join(fdir, 'src'), { recursive: true });
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: fdir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(fdir, 'src', 'components', 'Badge.tsx'),
      "import { Header } from './Header/Header';\nexport const Badge = () => <Header title=\"badge\" />;\n");
    g('add', '.'); g('commit', '-q', '-m', 'add Badge');
    g('checkout', '-q', 'main');
    const react = require('../src/defaults/react');
    const fcfg = Object.assign({}, react, { name: 'fe', root: 'src', aliases: { '@': 'src' }, __dir: fdir });
    const { change, model } = changeAt(fcfg, { range: 'main...feat' });
    assert.strictEqual(change.bricks['components/Badge.tsx#Badge'], 'added');
    assert.ok(model.bricks.some((b) => b.id === 'pages/ThingsPage/ThingsPage.tsx#ThingsPage'), '.tsx read from the commit');
    assert.deepStrictEqual(change.summary.attachments.map((a) => [a.brick, a.with]),
      [['components/Header/Header.tsx#Header', ['components/Badge.tsx#Badge']]]);
  } finally {
    fs.rmSync(fdir, { recursive: true, force: true });
  }
});

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
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, 'src', rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', rel), text);
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
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const cfg = () => Object.assign({}, nestjs, { name: 'g', root: 'src', __dir: dir });
const id = (rel, cls) => rel + '#' + cls;

test('a range resolves to its merge base, its head commit, and first-parent frames', () => {
  const r = resolveChange(cfg(), { range: 'main...feat' });
  assert.deepStrictEqual([r.base, r.head], [base, c2]);
  assert.deepStrictEqual(r.frames.map((f) => [f.sha, f.subject]),
    [[base, '(base)'], [c1, 'add NewService'], [c2, 'add UserService']]);
});

test('the head is read from git objects, not the working tree', () => {
  // main is checked out: neither feature file exists on disk.
  assert.ok(!fs.existsSync(path.join(dir, 'src', NEW)));
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
    fs.rmSync(path.join(dir, 'src', 'feature', 'draft.service.ts'));
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

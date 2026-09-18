'use strict';
/**
 * Spec 04 - blast radius (`metatron diff`). See docs/specs/04-blast-radius.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../src/diff');
const BL = require('../src/baseline');
const scan = require('../src/scan');
const { load } = require('../src/config');

const FIXTURE = path.join(__dirname, 'fixtures', 'diff');
const BIN = path.join(__dirname, '..', 'bin', 'metatron.js');

const REPO = 'notes/infra/repositories/note.repository.ts';
const REPO_V2 = 'notes/infra/repositories/v2/note.repository.ts';
const SVC = 'notes/domain/services/note.service.ts';
const ENT = 'notes/domain/entities/note.entity.ts';
const CREATE = 'notes/apps/actions/create-note/create-note.action.ts';
const LIST = 'notes/apps/actions/list-notes/list-notes.action.ts';
const MODULE = 'notes/notes.module.ts';
const TAGSVC = 'tags/domain/services/tag.service.ts';

/**
 * The fixture's import graph is built so that one commit to
 * `note.repository` reaches the whole tree by different routes:
 *
 *   notes.module -+-> create-note.action -+-> note.service -> note.repository
 *                 |-> list-notes.action --+        |
 *                 +-> note.service, note.repository +-> note.entity
 *   tags.module --+-> create-tag.action --> tag.service -> note.service
 *                 +-----------------------------+
 *
 * so a one-file range has 3 direct dependents and 7 transitively reachable
 * files, and every endpoint traces through the repository. Four violations
 * are stable at the fixture's first commit (action>repository,
 * service>repository, no-same-level, cross-domain); tests baseline them or
 * account for them.
 */
function withRepo(setup) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-diff-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const git = (a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(a), { cwd: tmp, stdio: 'pipe' });
  const commit = (m) => { git(['add', '-A']); git(['commit', '-q', '-m', m]); };
  const touch = (f, s) => fs.appendFileSync(path.join(tmp, f), s);
  try {
    git(['init', '-q', '-b', 'main']);
    commit('c0');
    const cfg = load(tmp);
    const extra = setup(git, commit, touch, cfg, tmp);
    return { tmp, cfg, git, commit, touch, extra };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('a one-file range report measures dependents, endpoints and risk', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    touch(SVC, '\n// c1\n'); commit('c1');
    touch(REPO, '\n// c2\n'); commit('c2');
    const r = D.analyze(cfg, { range: 'main~1...main' });

    assert.equal(r.files.total, 1);
    assert.equal(r.files.modified, 1);
    assert.deepEqual(r.changed, [{ path: REPO, status: 'modified' }]);

    // Direct dependents are the importers of the repository; the rest of the
    // tree reaches it through the service.
    assert.equal(r.blast.direct.length, 3);
    assert.ok(r.blast.direct.includes(SVC));
    assert.equal(r.blast.transitive, 7);
    assert.equal(r.blast.tree, 9);

    // All three endpoints trace through the repository.
    assert.equal(r.endpoints.affected.length, 3);
    const post = r.endpoints.affected.find((e) => e.route === '/notes' && e.verb === 'POST');
    assert.ok(post.via.includes(REPO));

    // No baseline on disk: the current violations that touch the changed file
    // are listed without pretending to be a delta.
    assert.equal(r.architecture.baseline, false);
    assert.equal(r.architecture.added.length, 2); // action>repository, service>repository

    // Risk crossings: the repository is the second hotspot, and no
    // co-change has accumulated above the support floor yet.
    assert.equal(r.look.hotspots.length, 1);
    assert.equal(r.look.hotspots[0].f, REPO);
    assert.equal(r.look.hotspots[0].rank, 2);
    assert.deepEqual(r.look.coupling, []);
    assert.deepEqual(r.untested, { files: [REPO], of: 1 });
  });
});

test('a deleted file keeps its blast radius through the base scan', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    // Delete the entity and leave the service's import dangling, as if
    // mid-refactor: the current scan has lost the link.
    fs.rmSync(path.join(tmp, ENT));
    commit('c1');
    const r = D.analyze(cfg, { range: 'main~1...main' });

    assert.equal(r.files.deleted, 1);
    // The service imports the entity only in the base model - the base scan
    // is the only evidence of the deletion's reach.
    assert.deepEqual(r.blast.direct, [SVC]);
    assert.equal(r.blast.transitive, 7);
  });
});

test('a pure rename is not a new violation plus a fixed one', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    BL.write(cfg, scan(cfg), null);
    commit('c0b');
    fs.mkdirSync(path.join(tmp, 'notes/infra/repositories/v2'), { recursive: true });
    fs.renameSync(path.join(tmp, REPO), path.join(tmp, REPO_V2));
    for (const f of [SVC, CREATE, MODULE]) {
      const p = path.join(tmp, f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('note.repository', 'v2/note.repository'));
    }
    commit('c1');
    const r = D.analyze(cfg, { range: 'main~1...main' });

    assert.deepEqual(r.files.renamed, [[REPO, REPO_V2]]);
    // The two violations that named the repository merely moved with it.
    assert.equal(r.architecture.folded, 2);
    assert.equal(r.architecture.added.length, 0);
    assert.equal(r.architecture.fixed.length, 0);
  });
});

test('deleting an action file reports its endpoint as removed', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    fs.rmSync(path.join(tmp, CREATE));
    commit('c1');
    const r = D.analyze(cfg, { range: 'main~1...main' });

    assert.equal(r.endpoints.removed.length, 1);
    assert.equal(r.endpoints.removed[0].id, 'POST /notes#apply');
    assert.equal(r.endpoints.affected.length, 0);
    // The module imports the deleted action only in the base model.
    assert.deepEqual(r.blast.direct, [MODULE]);
    assert.equal(r.blast.transitive, 1);
  });
});

test('--staged reports only what is about to be committed', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    touch(SVC, '\n// staged\n');
    git(['add', SVC]);
    touch(REPO, '\n// unstaged\n');
    const r = D.analyze(cfg, { staged: true });

    assert.equal(r.range, 'staged changes');
    assert.equal(r.files.total, 1);
    assert.deepEqual(r.changed, [{ path: SVC, status: 'modified' }]);
    // The unstaged edit to the repository is not part of the report.
    assert.equal(r.blast.transitive, 6);
  });
});

test('with no range, the default branch supplies the base', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    git(['checkout', '-q', '-b', 'feature']);
    touch(SVC, '\n// feature\n'); commit('feature work');
    const r = D.analyze(cfg, {});

    assert.equal(r.range, 'main...HEAD');
    assert.deepEqual(r.changed, [{ path: SVC, status: 'modified' }]);
  });
});

test('a new violation in untouched code is labelled a scan difference', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    BL.write(cfg, scan(cfg), null);
    commit('c0b');
    // c1: LIST gains a direct repository import - a new action>repository
    // violation, and LIST is the only changed file.
    const lp = path.join(tmp, LIST);
    fs.writeFileSync(lp, fs.readFileSync(lp, 'utf8')
      .replace("import { NoteService } from '../../../domain/services/note.service';",
        "import { NoteService } from '../../../domain/services/note.service';\nimport { NoteRepository } from '../../../infra/repositories/note.repository';"));
    commit('c1');
    // c2: TAGSVC gains its own repository import - two new violations
    // (service>repository and cross-domain), and TAGSVC is the only changed
    // file.
    const tp = path.join(tmp, TAGSVC);
    fs.writeFileSync(tp, fs.readFileSync(tp, 'utf8')
      .replace("import { NoteService } from '../../../notes/domain/services/note.service';",
        "import { NoteService } from '../../../notes/domain/services/note.service';\nimport { NoteRepository } from '../../../notes/infra/repositories/note.repository';"));
    commit('c2');
    const r = D.analyze(cfg, { range: 'main~1...main' });

    assert.equal(r.files.total, 1);
    assert.equal(r.architecture.added.length, 3);
    const drift = r.architecture.added.find((v) => v.from === LIST);
    assert.ok(drift);
    assert.equal(drift.inDiff, false);
    const mine = r.architecture.added.find((v) => v.from === TAGSVC);
    assert.ok(mine);
    assert.equal(mine.inDiff, true);
  });
});

test('outside a repository the failure names the problem', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-diff-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  try {
    const cfg = load(tmp);
    assert.throws(() => D.analyze(cfg, { staged: true }), /not a git repository/);
    assert.throws(() => D.analyze(cfg, { range: 'main...HEAD' }), /not a git repository/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the CLI renders terminal, markdown and json', () => {
  withRepo((git, commit, touch, cfg, tmp) => {
    touch(SVC, '\n// c1\n'); commit('c1');
    const term = execFileSync(process.execPath, [BIN, 'diff', 'main~1...main'], { cwd: tmp, encoding: 'utf8' });
    assert.ok(term.includes('blast radius'));
    const md = execFileSync(process.execPath, [BIN, 'diff', 'main~1...main', '--format=markdown'], { cwd: tmp, encoding: 'utf8' });
    assert.ok(md.includes('### metatron'));
    assert.ok(md.includes('**Blast radius**'));
    const js = execFileSync(process.execPath, [BIN, 'diff', 'main~1...main', '--json'], { cwd: tmp, encoding: 'utf8' });
    const j = JSON.parse(js);
    assert.equal(j.project, 'fixture');
    assert.equal(j.files.total, 1);
  });
});

'use strict';
/**
 * `metatron diff` — the blast radius of a git range (spec 04).
 *
 * Given a set of changed files, report what depends on them, which endpoints
 * they serve, and how the change moves the architecture relative to its
 * baseline.
 *
 * The change set comes from a git range only — no forge, no network. A range
 * works on any local branch, offline, before a PR exists, which is when the
 * answer is most useful.
 *
 * Deletions and renames are the trap: a deleted file has no node in the
 * current model, so its blast radius is computed from a second scan at the
 * base of the range, with content resolved from git objects — the working
 * tree is never checked out or stashed, so the command is safe to run
 * mid-edit.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const scan = require('./scan');
const BL = require('./baseline');
const { violationsOf, fingerprint } = require('./violations');

function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** `origin/HEAD` if the remote advertised one, else the usual suspects. */
function defaultBranch(dir) {
  try {
    const sym = git(dir, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).trim();
    if (sym) return sym.replace(/^refs\/remotes\//, '');
  } catch { /* not set */ }
  for (const c of ['main', 'master']) {
    try { git(dir, ['rev-parse', '--verify', '--quiet', c]); return c; } catch { /* next */ }
  }
  return null;
}

function isRepo(dir) {
  try { git(dir, ['rev-parse', '--is-inside-work-tree']); return true; } catch { return false; }
}
/**
 * Resolves the user's input to a base commit and the git range whose
 * `--name-status` diff is the change set.
 */
function resolve(dir, arg, staged) {
  if (!isRepo(dir)) throw new Error('not a git repository: ' + dir);
  if (staged) return { kind: 'staged', base: 'HEAD', range: null, label: 'staged changes' };
  if (!arg) {
    const def = defaultBranch(dir);
    if (!def) throw new Error(
      'cannot determine the default branch (no origin/HEAD, no local main or master).\n' +
      'Pass a range: metatron diff <base>...<head>');
    arg = def + '...HEAD';
  }
  const m = arg.match(/^(.+?)\.\.\.(.+)$/) || arg.match(/^(.+?)\.\.(.+)$/);
  if (!m) throw new Error('"' + arg + '" is not a range. Use <base>...<head>, e.g. main...HEAD');
  let base;
  try { base = git(dir, ['merge-base', m[1], m[2]]).trim(); }
  catch { throw new Error('no merge base for ' + m[1] + ' and ' + m[2] + ' — are they both commits in this repo?'); }
  return { kind: 'range', base, range: arg, label: arg };
}

/**
 * `git diff --name-status -M`, filtered to the scanned root. Rename
 * detection is on: a move must arrive as one `R` line, or it becomes a
 * deletion plus an addition and the report says the file vanished.
 */
function changeSet(gitRoot, relRoot, resolved) {
  const args = resolved.kind === 'staged'
    ? ['diff', '-M', '--name-status', '--cached', '--', relRoot]
    : ['diff', '-M', '--name-status', resolved.range, '--', relRoot];
  let out;
  try { out = git(gitRoot, args); }
  catch { throw new Error('not a git repository (or the range is not valid): ' + resolved.label); }
  const prefix = relRoot === '.' ? '' : relRoot + '/';
  const files = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const p = line.split('\t');
    const st = p[0][0];
    const raw = st === 'R' || st === 'C' ? p[2] : p[1];
    if (!raw.startsWith(prefix)) continue;
    if (st === 'R') files.push({ path: p[2].slice(prefix.length), oldPath: p[1].slice(prefix.length), status: 'renamed' });
    else if (st === 'C') files.push({ path: p[2].slice(prefix.length), oldPath: p[1].slice(prefix.length), status: 'copied' });
    else files.push({ path: p[1].slice(prefix.length), status: st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'modified' });
  }
  return files;
}

/**
 * The file map of a commit, straight from the object store. `ls-tree` names
 * the blobs; `cat-file --batch` reads them all in one process. Nothing is
 * checked out, so the working tree is never touched.
 */
function baseFileMap(gitRoot, relRoot, base, cfg) {
  const list = git(gitRoot, ['ls-tree', '-r', base, '--', relRoot]);
  const prefix = relRoot === '.' ? '' : relRoot + '/';
  const entries = [];
  for (const line of list.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const p = line.slice(tab + 1);
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (!rel.endsWith('.ts')) continue;
    if ((cfg.ignore || []).some((re) => re.test(path.join(gitRoot, relRoot, rel)))) continue;
    entries.push([line.slice(0, tab).split(' ')[2], rel]);
  }
  if (!entries.length) return {};
  const blobs = catBatch(gitRoot, entries.map(([s]) => s));
  const map = {};
  for (const [s, rel] of entries) if (blobs[s] !== undefined) map[rel] = blobs[s];
  return map;
}

function catBatch(dir, shas) {
  if (!shas.length) return {};
  const out = {};
  let buf;
  try {
    buf = execFileSync('git', ['cat-file', '--batch'], {
      cwd: dir, input: shas.join('\n') + '\n',
      maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { return {}; }
  let off = 0;
  for (const s of shas) {
    const nl = buf.indexOf(0x0a, off);
    const m = buf.toString('latin1', off, nl).match(/^([0-9a-f]{4,}) blob (\d+)$/);
    if (!m) break;
    const size = Number(m[2]);
    out[m[1]] = buf.toString('utf8', nl + 1, nl + 1 + size);
    off = nl + 1 + size + 1;
  }
  return out;
}

function baseModel(cfg, base, gitRoot, relRoot) {
  return scan(cfg, { files: baseFileMap(gitRoot, relRoot, base, cfg), churnAt: base });
}

/**
 * Reverse reachability: invert the import graph and walk outward, keeping
 * the shortest depth to each file. Depth 1 and depth 5 are different risks.
 */
function reachable(model, seeds) {
  const idx = new Map(model.fileNodes.map((n, i) => [n.f, i]));
  const rev = {};
  for (const l of model.fileLinks) (rev[l[1]] = rev[l[1]] || []).push(l[0]);
  const depth = {};
  const queue = [];
  for (const f of seeds) {
    const i = idx.get(f);
    if (i === undefined) continue;
    for (const d of rev[i] || []) if (depth[d] === undefined) { depth[d] = 1; queue.push(d); }
  }
  while (queue.length) {
    const i = queue.shift();
    for (const d of rev[i] || []) if (depth[d] === undefined) { depth[d] = depth[i] + 1; queue.push(d); }
  }
  const out = [];
  for (const [i, d] of Object.entries(depth)) out.push({ f: model.fileNodes[Number(i)].f, depth: d });
  return out;
}

/**
 * Call-based, not import-based: an endpoint is affected when a changed file
 * sits in its traced path, or is the file that owns it.
 */
function affectedEndpoints(model, changedSet) {
  const out = [];
  for (const e of model.endpoints) {
    const via = new Set();
    if (changedSet.has(e.file)) via.add(e.file);
    for (const h of e.flat) if (changedSet.has(h.file)) via.add(h.file);
    if (via.size) out.push({ id: e.id, verb: e.verb, route: e.route, handler: e.handler, file: e.file, via: [...via].sort() });
  }
  return out;
}

/**
 * New and fixed violations against the baseline, with renames folded: a
 * violation that merely moved with a renamed file is not new, and its old
 * fingerprint is not fixed. What survives is attributed — a new violation in
 * untouched code is a scan difference, not the diff's doing.
 */
function violationDelta(cur, baselineDoc, changedSet, renames) {
  const curV = cur.violations || violationsOf(cur);
  if (!baselineDoc) {
    const inDiff = curV
      .filter((v) => changedSet.has(v.from) || changedSet.has(v.to))
      .map((v) => Object.assign({}, v, { inDiff: true }));
    return { baseline: false, added: inDiff, fixed: [], folded: 0 };
  }
  const known = baselineDoc.violations;
  const added = curV.filter((v) => !known[v.fingerprint]);
  const curFps = new Set(curV.map((v) => v.fingerprint));
  let fixed = Object.entries(known)
    .filter(([fp]) => !curFps.has(fp))
    .map(([fp, v]) => Object.assign({ fingerprint: fp }, v));
  let folded = 0;
  for (const a of added.slice()) {
    let mate = null;
    for (const [old, nw] of renames) {
      const asFrom = a.from === nw && known[fingerprint(a.rule, old, a.to)];
      const asTo = a.to === nw && known[fingerprint(a.rule, a.from, old)];
      if (asFrom || asTo) { mate = asFrom ? fingerprint(a.rule, old, a.to) : fingerprint(a.rule, a.from, old); break; }
    }
    if (mate) {
      added.splice(added.indexOf(a), 1);
      fixed = fixed.filter((f) => f.fingerprint !== mate);
      folded++;
    }
  }
  for (const a of added) a.inDiff = changedSet.has(a.from) || changedSet.has(a.to);
  return { baseline: true, added, fixed, folded };
}

/**
 * Hotspot rank, co-change partners missing from the diff, and test presence —
 * the crossings that turn a list of changed files into "worth a look".
 */
function riskFor(model, files, changedSet, acc) {
  const fanIn = {};
  for (const l of model.fileLinks) fanIn[l[1]] = (fanIn[l[1]] || 0) + 1;
  const ranked = model.fileNodes
    .map((n, i) => {
      const c = model.churn && model.churn[n.f];
      if (!c) return null;
      const deps = fanIn[i] || 0;
      return { f: n.f, commits: c.commits, deps, score: c.commits * (1 + deps) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.f.localeCompare(b.f));
  const rankOf = new Map(ranked.map((r, i) => [r.f, i + 1]));
  for (const f of files) {
    if (!rankOf.has(f)) continue;
    const r = ranked[rankOf.get(f) - 1];
    acc.hotspots.push({ f, rank: rankOf.get(f), of: ranked.length, commits: r.commits, deps: r.deps });
  }
  for (const p of (model.coupling && model.coupling.pairs) || []) {
    const aIn = changedSet.has(p.a), bIn = changedSet.has(p.b);
    if (aIn === bIn) continue;
    const changed = aIn ? p.a : p.b, partner = aIn ? p.b : p.a;
    if (!files.includes(changed)) continue;
    acc.coupling.push({ changed, partner, co: p.co, total: p.changesA + p.changesB - p.co, pct: Math.round(p.degree * 100) });
  }
  const T = model.tests;
  if (T && T.meta && T.meta.reliable) {
    const sources = files.filter((f) => Object.prototype.hasOwnProperty.call(T.bySource, f));
    acc.sourceCount += sources.length;
    for (const f of sources) if (!T.bySource[f]) acc.untestedFiles.push(f);
  }
}

/**
 * The whole analysis: one scan of the working tree, one of the base commit,
 * and the crossings between them.
 */
function analyze(cfg, opts = {}) {
  const dir = cfg.__dir;
  const resolved = resolve(dir, opts.range, opts.staged);
  const gitRoot = git(dir, ['rev-parse', '--show-toplevel']).trim();
  const relRoot = path.relative(gitRoot, path.resolve(dir, cfg.root)) || '.';
  const changes = changeSet(gitRoot, relRoot, resolved);

  const cur = scan(cfg);
  const base = baseModel(cfg, resolved.base, gitRoot, relRoot);
  const curFiles = new Set(cur.fileNodes.map((n) => n.f));
  const baseFiles = new Set(base.fileNodes.map((n) => n.f));

  // A path counts as changed under both its current and its old name, so a
  // baseline violation touching the old name is attributed to the diff.
  const changedSet = new Set();
  for (const c of changes) { changedSet.add(c.path); if (c.oldPath) changedSet.add(c.oldPath); }

  // Seeds go to the model where the file's identity exists: a deleted file
  // only exists in the base, a rename in both (unioned below by path).
  const curSeeds = new Set(), baseSeeds = new Set();
  for (const c of changes) {
    if (curFiles.has(c.path)) curSeeds.add(c.path);
    if (c.status === 'deleted' && baseFiles.has(c.path)) baseSeeds.add(c.path);
    if ((c.status === 'renamed' || c.status === 'copied') && c.oldPath && baseFiles.has(c.oldPath)) baseSeeds.add(c.oldPath);
  }
  const byPath = new Map();
  for (const r of reachable(cur, curSeeds)) byPath.set(r.f, r.depth);
  for (const r of reachable(base, baseSeeds)) {
    if (!byPath.has(r.f) || r.depth < byPath.get(r.f)) byPath.set(r.f, r.depth);
  }
  for (const f of changedSet) byPath.delete(f);
  const direct = [...byPath.entries()].filter(([, d]) => d === 1).map(([f]) => f).sort();

  const removed = base.endpoints
    .filter((e) => changes.some((c) => c.status === 'deleted' && c.path === e.file))
    .map((e) => ({ id: e.id, verb: e.verb, route: e.route, file: e.file }));

  const look = { hotspots: [], coupling: [], untestedFiles: [], sourceCount: 0 };
  const curChanged = changes.map((c) => c.path).filter((f) => curFiles.has(f));
  const baseChanged = changes.map((c) => c.path).filter((f) => !curFiles.has(f) && baseFiles.has(f));
  riskFor(cur, curChanged, changedSet, look);
  if (baseChanged.length) riskFor(base, baseChanged, changedSet, look);
  look.hotspots.sort((a, b) => a.rank - b.rank);
  look.coupling.sort((a, b) => b.pct - a.pct || a.changed.localeCompare(b.changed));
  const untested = [...new Set(look.untestedFiles)];

  const renames = changes
    .filter((c) => c.status === 'renamed')
    .map((c) => [c.oldPath, c.path]);

  return {
    project: cur.project,
    range: resolved.label,
    files: {
      total: changes.length,
      added: changes.filter((c) => c.status === 'added').length,
      modified: changes.filter((c) => c.status === 'modified' || c.status === 'copied').length,
      deleted: changes.filter((c) => c.status === 'deleted').length,
      renamed: renames,
    },
    blast: {
      direct,
      transitive: byPath.size,
      tree: cur.stats.files,
      pct: cur.stats.files ? Math.round(1000 * byPath.size / cur.stats.files) / 10 : 0,
    },
    endpoints: { affected: affectedEndpoints(cur, changedSet), removed },
    architecture: violationDelta(cur, BL.read(cfg), changedSet, renames),
    changed: changes.map((c) => c.oldPath
      ? { path: c.path, status: c.status, oldPath: c.oldPath }
      : { path: c.path, status: c.status }),
    look: { hotspots: look.hotspots, coupling: look.coupling },
    untested: { files: untested, of: look.sourceCount },
  };
}

// ---------------------------------------------------------------- rendering

function filesLine(r) {
  const f = r.files;
  const bits = [];
  if (f.added) bits.push(f.added + ' added');
  if (f.modified) bits.push(f.modified + ' modified');
  if (f.deleted) bits.push(f.deleted + ' deleted');
  if (f.renamed.length) bits.push(f.renamed.length + ' renamed');
  return f.total + ' file' + (f.total === 1 ? '' : 's') + ' changed' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
}

function endpointNames(e) { return e.verb + ' ' + e.route; }
// An orphan violation has no target; don't draw a dangling arrow.
const vPair = (v) => (v.to ? v.from + ' → ' + v.to : v.from);

function renderTerminal(r) {
  if (!r.files.total) {
    return 'metatron · ' + r.project + ' · ' + r.range + '\nno files changed in the scanned root\n';
  }
  const L = [];
  L.push('metatron · ' + r.project + ' · ' + r.range);
  L.push(filesLine(r));
  L.push('');
  L.push('blast radius: ' + r.blast.direct.length + ' direct dependent' + (r.blast.direct.length === 1 ? '' : 's') +
    ', ' + r.blast.transitive + ' transitively reachable (' + r.blast.pct + '% of ' + r.blast.tree + ' files)');
  if (r.blast.direct.length) L.push('  direct: ' + r.blast.direct.join(', '));
  const aff = r.endpoints.affected;
  if (aff.length || r.endpoints.removed.length) {
    L.push('');
    L.push('endpoints affected: ' + aff.length +
      (r.endpoints.removed.length ? ' (' + r.endpoints.removed.length + ' removed with a deleted file)' : ''));
    for (const e of aff.slice(0, 5)) L.push('  ' + endpointNames(e));
    if (aff.length > 5) L.push('  … (' + (aff.length - 5) + ' more)');
  }
  const a = r.architecture;
  L.push('');
  if (a.baseline) {
    if (!a.added.length && !a.fixed.length) L.push('architecture: unchanged vs baseline');
    else {
      L.push('architecture: +' + a.added.length + ' / −' + a.fixed.length + ' vs baseline');
      for (const v of a.added) {
        L.push('  new    ' + v.rule + '   ' + vPair(v) +
          (v.inDiff ? '' : '   — untouched files; a scan difference, not this diff'));
      }
      for (const v of a.fixed) L.push('  fixed  ' + v.rule + '   ' + vPair(v));
      if (a.folded) L.push('  (' + a.folded + ' violation' + (a.folded === 1 ? '' : 's') + ' moved with a rename; not counted)');
    }
  } else {
    L.push('architecture: no arch.baseline.json — no delta');
    if (a.added.length) {
      L.push('  ' + a.added.length + ' current violation' + (a.added.length === 1 ? ' touches' : 's touch') + ' changed files:');
      for (const v of a.added) L.push('    ' + v.rule + '   ' + vPair(v));
    }
  }
  const look = lookLines(r);
  if (look.length) { L.push(''); L.push('worth a look'); for (const x of look) L.push('  ' + x); }
  return L.join('\n') + '\n';
}

function renderMarkdown(r) {
  if (!r.files.total) {
    return '### metatron · ' + r.range + '\n\nNo files changed in the scanned root.\n';
  }
  const L = [];
  L.push('### metatron · ' + filesLine(r));
  L.push('');
  L.push('**Blast radius** — ' + r.blast.direct.length + ' direct dependent' + (r.blast.direct.length === 1 ? '' : 's') + ', ' +
    r.blast.transitive + ' transitively reachable (' + r.blast.pct + '% of the tree)');
  L.push('');
  const aff = r.endpoints.affected;
  if (aff.length || r.endpoints.removed.length) {
    const shown = aff.slice(0, 5).map((e) => '`' + endpointNames(e) + '`').join(' · ');
    L.push('**Endpoints affected** — ' + aff.length +
      (r.endpoints.removed.length ? ' (' + r.endpoints.removed.length + ' removed with a deleted file)' : ''));
    if (aff.length) L.push(shown + (aff.length > 5 ? ' · … (' + (aff.length - 5) + ' more)' : ''));
    L.push('');
  }
  const a = r.architecture;
  if (a.baseline) {
    if (!a.added.length && !a.fixed.length) L.push('**Architecture** — unchanged vs baseline');
    else {
      L.push('**Architecture** — +' + a.added.length + ' / −' + a.fixed.length + ' vs baseline');
      for (const v of a.added)
        L.push('- new  `' + v.rule + '`  ' + vPair(v) +
          (v.inDiff ? '' : '  *(untouched files — a scan difference, not this diff)*'));
      for (const v of a.fixed) L.push('- fixed  `' + v.rule + '`  ' + vPair(v));
      if (a.folded) L.push('- (' + a.folded + ' violation' + (a.folded === 1 ? '' : 's') + ' moved with a rename; not counted)');
    }
  } else {
    L.push('**Architecture** — no `arch.baseline.json`, no delta' +
      (a.added.length ? '; ' + a.added.length + ' current violation' + (a.added.length === 1 ? ' touches' : 's touch') +
        ' changed files: ' + a.added.map((v) => '`' + v.rule + '` ' + vPair(v)).join(', ') : ''));
  }
  L.push('');
  const look = lookLines(r);
  if (look.length) {
    L.push('**Worth a look**');
    for (const x of look) L.push('- ' + x);
  }
  return L.join('\n') + '\n';
}

function lookLines(r) {
  const out = [];
  for (const h of r.look.hotspots) {
    out.push('`' + h.f + '` is hotspot #' + h.rank + ' of ' + h.of + ' (' + h.commits + (h.commits === 1 ? ' commit' : ' commits') + ', ' + h.deps + (h.deps === 1 ? ' dependent' : ' dependents') + ')');
  }
  for (const c of r.look.coupling) {
    out.push('`' + c.changed + '` co-changes with `' + c.partner + '` ' + c.pct + '% of the time (' + c.co + ' of ' + c.total + ' commits) — not in this diff');
  }
  if (r.untested.files.length) {
    out.push(r.untested.files.length + ' of ' + r.untested.of + ' changed source file' + (r.untested.files.length === 1 ? '' : 's') +
      (r.untested.files.length === 1 ? ' has' : ' have') + ' no test: ' + r.untested.files.map((f) => '`' + f + '`').join(', '));
  }
  return out;
}

function renderJson(r) {
  return JSON.stringify(r, null, 2);
}

module.exports = { analyze, resolve, changeSet, baseModel, reachable, affectedEndpoints,
                   violationDelta, renderTerminal, renderMarkdown, renderJson };

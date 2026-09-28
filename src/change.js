'use strict';
/**
 * The change overlay (spec 11): what a change *is*, structurally.
 *
 * Two wiring models — the base and the head of a change — are compared
 * brick by brick and connection by connection. Every brick is added,
 * removed, edited or unchanged; every new connection is classified by which
 * of its ends already existed. That last split is the point: it says where
 * new code meets the old.
 */

/** Trailing whitespace ignored; a brick that only moved keeps its text. */
function slice(text, lines) {
  if (text == null) return null;
  return text.split('\n').slice(lines[0] - 1, lines[1]).map((l) => l.replace(/\s+$/, '')).join('\n');
}

/**
 * @param base, head  scan() models (with their non-enumerable __text)
 * @param renames     [[oldPath, newPath]] from `git diff -M`
 */
function compare(base, head, renames = []) {
  const moved = new Map(renames);
  const remap = (id) => {
    if (!id) return id;
    const i = id.indexOf('#');
    const file = i < 0 ? id : id.slice(0, i);
    return moved.has(file) ? moved.get(file) + (i < 0 ? '' : id.slice(i)) : id;
  };
  const baseFileOf = new Map(renames.map(([o, n]) => [n, o]));
  const bText = base.__text || {}, hText = head.__text || {};

  const baseBricks = new Map(base.bricks.map((b) => [remap(b.id), b]));
  const headBricks = new Map(head.bricks.map((b) => [b.id, b]));
  const existed = (id) => baseBricks.has(id);

  const bricks = {}, studs = {};
  const removed = [];
  const count = { added: 0, removed: 0, edited: 0, unchanged: 0 };
  for (const [id, h] of headBricks) {
    const b = baseBricks.get(id);
    let st;
    if (!b) st = 'added';
    else {
      const bf = baseFileOf.get(h.file) || h.file;
      st = slice(bText[bf], b.lines) === slice(hText[h.file], h.lines) ? 'unchanged' : 'edited';
      if (st === 'edited') studs[id] = compareParts(b, h, bText[bf], hText[h.file]);
    }
    bricks[id] = st;
    count[st]++;
  }
  for (const [id, b] of baseBricks) {
    if (headBricks.has(id)) continue;
    // The whole brick as it was, so the bench can draw it as a ghost and the
    // inspector can show what went: its studs, sockets and line range.
    removed.push(Object.assign({}, b, { id }));
    count.removed++;
  }

  // Connections, reduced to brick pairs. A call through a port joins the
  // caller to the port and the port to the class bound to it, as on the bench.
  const pairsOf = (model, map) => {
    const out = new Map();
    const get = (f, t) => {
      const k = f + '\u0000' + t;
      if (!out.has(k)) out.set(k, { from: f, to: t, calls: new Set() });
      return out.get(k);
    };
    for (const w of model.wires) {
      get(map(w.from), map(w.to));
      if (w.boundTo) get(map(w.to), map(w.boundTo));
    }
    for (const c of model.calls) {
      get(map(c.from), map(c.to)).calls.add((c.fromMethod || '(module)') + ' > ' + c.toMethod);
      if (c.boundTo) get(map(c.to), map(c.boundTo)).calls.add('(bound) > ' + c.toMethod);
    }
    return out;
  };
  const bp = pairsOf(base, remap);
  const hp = pairsOf(head, (x) => x);

  const pairs = [];
  for (const [k, p] of hp) {
    const was = bp.get(k);
    if (!was) {
      const cls = existed(p.from)
        ? (existed(p.to) ? 'rewire' : 'graft')
        : (existed(p.to) ? 'attachment' : 'territory');
      pairs.push({ from: p.from, to: p.to, class: cls, calls: [...p.calls].sort() });
    } else {
      const fresh = [...p.calls].filter((c) => !was.calls.has(c)).sort();
      const gone = [...was.calls].filter((c) => !p.calls.has(c)).sort();
      if (fresh.length || gone.length) pairs.push({ from: p.from, to: p.to, class: 'kept', newCalls: fresh, goneCalls: gone });
    }
  }
  for (const [k, p] of bp) {
    if (!hp.has(k)) pairs.push({ from: p.from, to: p.to, class: 'detached', calls: [...p.calls].sort() });
  }
  pairs.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));

  return { bricks, studs, removed, pairs, summary: summarise(count, pairs) };
}

/** Studs and internals of an edited brick, by name. */
function compareParts(b, h, bSrc, hSrc) {
  const key = (s) => (s.static ? 'static ' : '') + s.name;
  const bParts = new Map([...b.studs, ...b.internals].map((s) => [key(s), s]));
  const out = {};
  for (const s of [...h.studs, ...h.internals]) {
    const was = bParts.get(key(s));
    out[s.name] = !was ? 'added' : slice(bSrc, was.lines) === slice(hSrc, s.lines) ? 'unchanged' : 'edited';
  }
  for (const [k, s] of bParts) if (!out[s.name] && !h.studs.concat(h.internals).some((x) => key(x) === k)) out[s.name] = 'removed';
  return out;
}

function summarise(count, pairs) {
  const group = (cls, by) => {
    const g = new Map();
    for (const p of pairs.filter((x) => x.class === cls)) {
      const k = p[by];
      if (!g.has(k)) g.set(k, { brick: k, with: [], calls: 0 });
      const e = g.get(k);
      e.with.push(by === 'to' ? p.from : p.to);
      e.calls += p.calls.length;
    }
    return [...g.values()].sort((a, b) => b.with.length - a.with.length || b.calls - a.calls || a.brick.localeCompare(b.brick));
  };
  return Object.assign({}, count, {
    // Where the change meets the codebase: grouped by the existing brick.
    attachments: group('attachment', 'to'),
    grafts: group('graft', 'from'),
    rewires: pairs.filter((p) => p.class === 'rewire').map((p) => ({ from: p.from, to: p.to, calls: p.calls })),
    territory: pairs.filter((p) => p.class === 'territory').length,
    detached: pairs.filter((p) => p.class === 'detached').length,
    newCallsOnKept: pairs.filter((p) => p.class === 'kept').reduce((a, p) => a + p.newCalls.length, 0),
  });
}

// ------------------------------------------------------------------ git
const { execFileSync } = require('child_process');
const path = require('path');
const scan = require('./scan');
const D = require('./diff');

/**
 * What to compare. The head of a range is read from git objects, never from
 * the working tree: a PR reviewed from main must show the PR.
 *
 *   {}             merge base of the default branch and HEAD ... working tree
 *   { range }      merge base of A and B ... commit B
 *   { pr }         the PR's merge base ... the PR's head commit
 *
 * Frames are the first-parent commits from base to head, oldest first, so a
 * merge from the base branch is one frame, not a replay of it. Work in
 * progress adds a last frame for the working tree when it differs.
 */
function resolveChange(cfg, spec = {}, opts = {}) {
  const dir = cfg.__dir;
  const git = (args) => D.git(dir, args);
  try { git(['rev-parse', '--is-inside-work-tree']); } catch { throw new Error('not a git repository: ' + dir); }
  const gitRoot = git(['rev-parse', '--show-toplevel']).trim();
  const relRoot = path.relative(gitRoot, path.resolve(dir, cfg.root)) || '.';
  const commit = (ref) => {
    try { return git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']).trim(); } catch { return null; }
  };
  const mergeBase = (a, b) => {
    try { return git(['merge-base', a, b]).trim(); }
    catch { throw new Error('no merge base for ' + a + ' and ' + b + ' — are they both commits in this repo?'); }
  };

  let label, base, head;
  if (spec.pr) {
    const n = String(spec.pr).replace(/^#/, '');
    if (!/^\d+$/.test(n)) throw new Error('not a PR number: ' + spec.pr);
    const info = (opts.gh || ghPr)(dir, n);
    for (const [what, sha] of [['head', info.headRefOid], ['base', info.baseRefOid]]) {
      if (!commit(sha)) {
        throw new Error(`the PR's ${what} commit ${sha.slice(0, 7)} is not in this repository.\n` +
          (what === 'head' ? `  git fetch origin pull/${n}/head` : '  git fetch origin'));
      }
    }
    head = info.headRefOid;
    base = mergeBase(info.baseRefOid, head);
    label = `#${n}${info.title ? ' ' + info.title : ''}`;
  } else if (spec.range) {
    const m = spec.range.match(/^(.+?)\.\.\.(.+)$/) || spec.range.match(/^(.+?)\.\.(.+)$/);
    if (!m) throw new Error('"' + spec.range + '" is not a range. Use <base>...<head>, e.g. main...feat/x');
    head = commit(m[2]);
    if (!head) throw new Error('not a commit: ' + m[2]);
    base = mergeBase(m[1], head);
    label = spec.range;
  } else {
    const def = D.defaultBranch(dir);
    if (!def) throw new Error('cannot determine the default branch (no origin/HEAD, no local main or master)');
    base = mergeBase(def, 'HEAD');
    head = null;
    label = 'work in progress on ' + (git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() || 'HEAD') + ' vs ' + def;
  }

  const log = git(['log', '--reverse', '--first-parent', '--format=%H%x09%s', base + '..' + (head || 'HEAD')]);
  const frames = [{ sha: base, subject: '(base)' }];
  for (const line of log.split('\n')) {
    if (!line) continue;
    const t = line.indexOf('\t');
    frames.push({ sha: line.slice(0, t), subject: line.slice(t + 1) });
  }
  // Pathspecs are relative to the repository root, so these run there, not
  // in the config's directory (a `backend/` beside a `frontend/`).
  if (!head && D.git(gitRoot, ['status', '--porcelain', '--', relRoot]).trim()) frames.push({ sha: null, subject: '(uncommitted)' });
  return { label, base, head, frames, gitRoot, relRoot };
}

function ghPr(dir, n) {
  let out;
  try {
    out = execFileSync('gh', ['pr', 'view', n, '--json', 'baseRefOid,headRefOid,title'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error('gh pr view ' + n + ' failed: ' + String(e.stderr || e.message).trim().split('\n')[0]);
  }
  return JSON.parse(out);
}

/** Renames between the base and a frame (null sha: the working tree). */
function renamesBetween(r, sha) {
  const args = ['diff', '-M', '--name-status', r.base].concat(sha ? [sha] : []).concat(['--', r.relRoot]);
  const prefix = r.relRoot === '.' ? '' : r.relRoot + '/';
  const out = [];
  for (const line of D.git(r.gitRoot, args).split('\n')) {
    const p = line.split('\t');
    if (p[0] && p[0][0] === 'R' && p[1].startsWith(prefix) && p[2].startsWith(prefix)) {
      out.push([p[1].slice(prefix.length), p[2].slice(prefix.length)]);
    }
  }
  return out;
}

/** Scans by commit, keeping the last few: scrubbing must not re-scan. */
function modelCache(size = 8) {
  const map = new Map();
  return {
    get(cfg, r, sha) {
      if (map.has(sha)) { const m = map.get(sha); map.delete(sha); map.set(sha, m); return m; }
      const m = scan(cfg, { files: D.baseFileMap(r.gitRoot, r.relRoot, sha, cfg), churnAt: sha });
      map.set(sha, m);
      if (map.size > size) map.delete(map.keys().next().value);
      return m;
    },
  };
}

/**
 * The change at one frame: the head model, and the overlay against the base.
 * `current` is the working-tree model, used for the uncommitted frame.
 */
function changeAt(cfg, spec, opts = {}) {
  const r = resolveChange(cfg, spec, opts);
  const cache = opts.cache || modelCache();
  const last = r.frames.length - 1;
  const frame = opts.frame === undefined || opts.frame === null ? last : Math.max(0, Math.min(last, Number(opts.frame)));
  const at = r.frames[frame];
  const baseModel = cache.get(cfg, r, r.base);
  const headModel = at.sha ? cache.get(cfg, r, at.sha) : (opts.current || scan(cfg));
  const cmp = compare(baseModel, headModel, renamesBetween(r, at.sha));
  return {
    model: headModel,
    base: baseModel,
    change: Object.assign({
      label: r.label, base: r.base, head: r.head, frame, rev: at.sha,
      frames: r.frames.map((f) => ({ sha: f.sha, subject: f.subject })),
    }, cmp),
  };
}

module.exports = { compare, resolveChange, changeAt, modelCache };

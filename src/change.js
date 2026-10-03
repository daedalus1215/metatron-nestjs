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

  return { bricks, studs, removed, pairs, summary: summarise(count, pairs), count };
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

// ------------------------------------------------------------ the stack

const side = (tag) => (id) => (id === null || id === undefined ? id : tag + ':' + id);

/** A side's compare, keyed as the joined workbench keys it. */
function prefixed(c, tag) {
  const p = side(tag);
  const byKey = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [p(k), v]));
  return {
    bricks: byKey(c.bricks), studs: byKey(c.studs),
    removed: c.removed.map((r) => Object.assign({}, r, { id: p(r.id), file: p(r.file), module: p(r.module), side: tag })),
    pairs: c.pairs.map((x) => Object.assign({}, x, { from: p(x.from), to: p(x.to) })),
  };
}

/** Base ids moved by a rename, onto their head ids. */
const renamer = (renames) => {
  const moved = new Map(renames);
  return (id) => {
    if (!id) return id;
    const i = id.indexOf('#');
    const file = i < 0 ? id : id.slice(0, i);
    return moved.has(file) ? moved.get(file) + (i < 0 ? '' : id.slice(i)) : id;
  };
};

// A call is known across a change's two ends by its brick, verb and URL.
const callKey = (from, c) => from + '\u0000' + c.verb + '\u0000' + c.path;

/**
 * The contract drift a change introduced (spec 15): each matched call whose
 * request or response differs at the head, where it did not differ in the
 * same way at the base, or did not exist. Each side is null when it is not
 * new drift; `was` is what the base said, if the call was there.
 */
function contractDriftOf(baseFe, headFe, feMove) {
  const before = new Map();
  for (const c of baseFe.calls) if (c.kind === 'http' && c.contract) before.set(callKey(feMove(c.from), c), c.contract);
  const out = [];
  for (const c of headFe.calls) {
    if (c.kind !== 'http' || !c.contract) continue;
    const was = before.get(callKey(c.from, c));
    const fresh = (side) => c.contract[side].status === 'differ'
      && !(was && JSON.stringify(was[side]) === JSON.stringify(c.contract[side]));
    const request = fresh('request'), response = fresh('response');
    if (!request && !response) continue;
    out.push({ from: 'fe:' + c.from, fromMethod: c.fromMethod, verb: c.verb, path: c.path, line: c.line, endpoint: c.endpoint,
      request: request ? c.contract.request : null, response: response ? c.contract.response : null,
      was: was ? { request: was.request.status, response: was.response.status } : null });
  }
  return out;
}

/**
 * A change across a frontend and its backend (spec 13): each side compared
 * as in spec 11, and the HTTP edges between them compared on their own.
 *
 * Each model's frontend must be bridged to the backend of the same commit.
 * An HTTP pair is (frontend brick making the call, backend brick owning the
 * endpoint), classed by which ends already existed, like any pair.
 *
 * @param renames  { fe: [[old, new]], be: [[old, new]] }
 */
function stackCompare(baseFe, headFe, baseBe, headBe, renames = {}) {
  const fe = compare(baseFe, headFe, renames.fe || []);
  const be = compare(baseBe, headBe, renames.be || []);
  const F = prefixed(fe, 'fe'), B = prefixed(be, 'be');
  const feMove = renamer(renames.fe || []), beMove = renamer(renames.be || []);

  // ---- HTTP pairs
  const httpPairs = (fm, fmove, bmove) => {
    const out = new Map();
    for (const c of fm.calls) {
      if (c.kind !== 'http' || c.match !== 'matched') continue;
      const from = 'fe:' + fmove(c.from), to = 'be:' + bmove(c.endpointBrick);
      const k = from + '\u0000' + to;
      if (!out.has(k)) out.set(k, { from, to, calls: new Set() });
      out.get(k).calls.add((c.fromMethod || '(module)') + ' > ' + c.endpoint.split('#')[0]);
    }
    return out;
  };
  const hb = httpPairs(baseFe, feMove, beMove), hh = httpPairs(headFe, (x) => x, (x) => x);
  const existed = (id) => {
    const status = id.startsWith('fe:') ? F.bricks[id] : B.bricks[id];
    return status !== undefined && status !== 'added';
  };
  const http = { attachment: 0, graft: 0, rewire: 0, territory: 0, detached: 0 };
  const stackPairs = [];
  for (const [k, p] of hh) {
    const was = hb.get(k);
    if (!was) {
      const cls = existed(p.from) ? (existed(p.to) ? 'rewire' : 'graft') : (existed(p.to) ? 'attachment' : 'territory');
      http[cls]++;
      stackPairs.push({ from: p.from, to: p.to, class: cls, calls: [...p.calls].sort(), http: true });
    } else {
      const fresh = [...p.calls].filter((c) => !was.calls.has(c)).sort();
      const gone = [...was.calls].filter((c) => !p.calls.has(c)).sort();
      if (fresh.length || gone.length) stackPairs.push({ from: p.from, to: p.to, class: 'kept', newCalls: fresh, goneCalls: gone, http: true });
    }
  }
  for (const [k, p] of hb) {
    if (hh.has(k)) continue;
    http.detached++;
    stackPairs.push({ from: p.from, to: p.to, class: 'detached', calls: [...p.calls].sort(), http: true });
  }

  // ---- endpoints, and the calls that reach them
  const callersOf = (fm, id, fmove) => [...new Set(fm.calls
    .filter((c) => c.kind === 'http' && c.endpoint === id).map((c) => 'fe:' + fmove(c.from)))].sort();
  const eb = new Set(baseBe.endpoints.map((e) => e.id)), eh = new Set(headBe.endpoints.map((e) => e.id));
  const endpointsAdded = headBe.endpoints.filter((e) => !eb.has(e.id))
    .map((e) => ({ id: e.id, calledBy: callersOf(headFe, e.id, (x) => x) }));
  const endpointsRemoved = baseBe.endpoints.filter((e) => !eh.has(e.id))
    .map((e) => ({ id: e.id, calledBy: callersOf(baseFe, e.id, feMove) }));

  // ---- broken calls: new calls into nothing, and calls the change cut off.
  const before = new Map();
  for (const c of baseFe.calls) if (c.kind === 'http') before.set(callKey(feMove(c.from), c), c);
  // And calls it repaired: broken at the base, reaching a served endpoint now.
  const broken = [], unread = [], fixed = [];
  const BROKEN = ['unmatched', 'ambiguous', 'unserved'];
  for (const c of headFe.calls) {
    if (c.kind !== 'http') continue;
    if (c.match === 'unread') { unread.push({ from: 'fe:' + c.from, verb: c.verb, line: c.line }); continue; }
    const was = before.get(callKey(c.from, c));
    if (c.match === 'matched') {
      if (was && BROKEN.includes(was.match)) {
        fixed.push({ from: 'fe:' + c.from, fromMethod: c.fromMethod, verb: c.verb, path: c.path, line: c.line,
          endpoint: c.endpoint, was: was.match });
      }
      continue;
    }
    if (was && was.match !== 'matched') continue;       // broken before the change too: not its doing
    broken.push({ from: 'fe:' + c.from, fromMethod: c.fromMethod, verb: c.verb, path: c.path, line: c.line,
      match: c.match, endpoint: c.endpoint || null, was: was ? was.endpoint : null });
  }

  // ---- merged
  const pairs = F.pairs.concat(B.pairs, stackPairs)
    .sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));
  const count = {};
  for (const k of ['added', 'removed', 'edited', 'unchanged']) count[k] = fe.count[k] + be.count[k];
  const summary = summarise(count, pairs);
  summary.stack = { endpointsAdded, endpointsRemoved, broken, fixed, unread, http,
    contractDrift: contractDriftOf(baseFe, headFe, feMove),
    sides: { fe: fe.summary, be: be.summary } };
  return {
    bricks: Object.assign({}, F.bricks, B.bricks), studs: Object.assign({}, F.studs, B.studs),
    removed: F.removed.concat(B.removed), pairs, summary,
  };
}

// ------------------------------------------------------------------ git
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
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
 *   { commits }    the parent of the oldest ... those commits alone, applied
 *                  in order (a hand-picked set, or one commit)
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
  if (spec.commits) {
    return resolveSet(spec.commits, { dir, gitRoot, relRoot, commit, git });
  }
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
  if (!head && D.git(gitRoot, ['status', '--porcelain', '--', relRoot].concat(opts.alsoRoots || [])).trim()) frames.push({ sha: null, subject: '(uncommitted)' });
  return { label, base, head, frames, gitRoot, relRoot };
}

/**
 * A set of commits, not a range. The base is the first parent of the oldest;
 * frame k is that base with the first k commits of the set applied in order.
 * While the set is an unbroken first-parent chain from the base, a frame is
 * simply that commit. Past the first gap it is built (`applyFrame`).
 */
function resolveSet(list, ctx) {
  const { commit, git, gitRoot, relRoot } = ctx;
  const refs = (Array.isArray(list) ? list : String(list).split(/[\s,]+/)).filter(Boolean);
  if (!refs.length) throw new Error('no commits given');
  const shas = [];
  for (const ref of refs) {
    const sha = commit(ref);
    if (!sha) throw new Error('not a commit: ' + ref);
    if (!shas.includes(sha)) shas.push(sha);
  }
  // Oldest first, by ancestry, not by clock: commits made in the same second
  // sort arbitrarily by time. Walk topologically from the set's common
  // ancestor; commits on unrelated lines keep git's order between them.
  let order = shas;
  try {
    const mb = git(['merge-base', '--octopus'].concat(shas)).trim();
    const walked = git(['rev-list', '--topo-order', '--reverse'].concat(shas, ['^' + mb])).split('\n');
    order = (shas.includes(mb) ? [mb] : []).concat(walked.filter((x) => shas.includes(x)));
  } catch { /* no common ancestor: keep the order given */ }
  const info = {};
  for (const line of git(['log', '--no-walk', '--format=%H%x09%P%x09%s'].concat(shas)).split('\n')) {
    if (!line) continue;
    const [sha, parents, subject] = line.split('\t');
    info[sha] = { sha, parent: parents.split(' ')[0] || null, subject };
  }
  const picked = order.map((sha) => info[sha]);
  if (!picked[0].parent) throw new Error(`${picked[0].sha.slice(0, 7)} is a root commit: it has no parent to compare with`);
  const base = picked[0].parent;
  const frames = [{ sha: base, subject: '(base)' }];
  let chain = true;
  picked.forEach((c, i) => {
    chain = chain && c.parent === (i ? picked[i - 1].sha : base);
    const f = { sha: c.sha, subject: c.subject };
    if (!chain) {
      // Built, not checked out: its key names exactly which commits it holds.
      f.rev = 'set-' + crypto.createHash('sha1').update(picked.slice(0, i + 1).map((x) => x.sha).join(',')).digest('hex').slice(0, 16);
      f.apply = picked.slice(0, i + 1);
    }
    frames.push(f);
  });
  const label = picked.length === 1
    ? `${picked[0].sha.slice(0, 7)} ${picked[0].subject}`
    : `${picked.length} commits: ` + picked.map((c) => c.sha.slice(0, 7)).join(', ');
  return { label, base, head: null, set: picked.map((c) => c.sha), frames, gitRoot, relRoot };
}

/**
 * The tree of a built frame, read without touching the repository: a
 * temporary index, and a temporary object store with the repository's as an
 * alternate. `git apply --cached` writes the blobs it makes there, and the
 * directory is removed after. A commit that does not apply without one left
 * out of the set is refused, by name.
 */
function applyFrame(r, frame, cfg, relRoot = r.relRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-set-'));
  try {
    const objects = path.join(tmp, 'objects');
    fs.mkdirSync(objects);
    const env = Object.assign({}, process.env, {
      GIT_INDEX_FILE: path.join(tmp, 'index'),
      GIT_OBJECT_DIRECTORY: objects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: D.git(r.gitRoot, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']).trim(),
    });
    const g = (args, input) => execFileSync('git', args, {
      cwd: r.gitRoot, env, input, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
    g(['read-tree', r.base]);
    for (const c of frame.apply) {
      const patch = g(['diff', '--binary', '--full-index', c.parent, c.sha, '--', relRoot]);
      if (!patch.trim()) continue;
      try { g(['apply', '--cached', '--whitespace=nowarn'], patch); }
      catch (e) {
        const why = String(e.stderr || e.message).trim().split('\n')[0];
        throw new Error(`${c.sha.slice(0, 7)} "${c.subject}" does not apply without commits left out of the set.\n  ${why}`);
      }
    }
    const files = D.indexFileMap(r.gitRoot, relRoot, cfg, env);
    const prefix = relRoot === '.' ? '' : relRoot + '/';
    const renames = [];
    for (const line of g(['diff-index', '-M', '--cached', '--name-status', r.base, '--', relRoot]).split('\n')) {
      const p = line.split('\t');
      if (p[0] && p[0][0] === 'R' && p[1].startsWith(prefix) && p[2].startsWith(prefix)) {
        renames.push([p[1].slice(prefix.length), p[2].slice(prefix.length)]);
      }
    }
    return { files, renames };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
function renamesBetween(r, sha, relRoot = r.relRoot) {
  const args = ['diff', '-M', '--name-status', r.base].concat(sha ? [sha] : []).concat(['--', relRoot]);
  const prefix = relRoot === '.' ? '' : relRoot + '/';
  const out = [];
  for (const line of D.git(r.gitRoot, args).split('\n')) {
    const p = line.split('\t');
    if (p[0] && p[0][0] === 'R' && p[1].startsWith(prefix) && p[2].startsWith(prefix)) {
      out.push([p[1].slice(prefix.length), p[2].slice(prefix.length)]);
    }
  }
  return out;
}

/** Scans by key (a commit, or a built frame), keeping the last few: scrubbing must not re-scan. */
function modelCache(size = 8) {
  const map = new Map();
  return {
    get(key, load) {
      if (map.has(key)) { const m = map.get(key); map.delete(key); map.set(key, m); return m; }
      const m = load();
      map.set(key, m);
      if (map.size > size) map.delete(map.keys().next().value);
      return m;
    },
  };
}

/**
 * The change at one frame: the head model, and the overlay against the base.
 * `current` is the working-tree model, used for the uncommitted frame.
 */
/**
 * A frontend's linked backend, when it shares the frontend's repository: the
 * one case where both sides have the same history (spec 13). Otherwise
 * null, with `other` set when a backend is linked but lives elsewhere.
 */
function stackOf(cfg) {
  if (cfg.wiring !== 'react' || !cfg.backend) return null;
  const { load } = require('./config');
  let bcfg;
  try { bcfg = load(path.resolve(cfg.__dir, cfg.backend)); } catch { return null; }
  const top = (dir) => { try { return D.git(dir, ['rev-parse', '--show-toplevel']).trim(); } catch { return null; } };
  const gitRoot = top(cfg.__dir);
  if (!gitRoot || top(bcfg.__dir) !== gitRoot) return { other: true };
  return {
    cfg: bcfg,
    relRoot: path.relative(gitRoot, path.resolve(bcfg.__dir, bcfg.root)).split(path.sep).join('/') || '.',
    label: path.relative(cfg.__dir, bcfg.__dir) || '.',
  };
}

function changeAt(cfg, spec, opts = {}) {
  const stack = stackOf(cfg);
  const r = resolveChange(cfg, spec, Object.assign({}, opts, stack && stack.relRoot ? { alsoRoots: [stack.relRoot] } : {}));
  const cache = opts.cache || modelCache();
  const last = r.frames.length - 1;
  const frame = opts.frame === undefined || opts.frame === null ? last : Math.max(0, Math.min(last, Number(opts.frame)));
  const at = r.frames[frame];
  if (stack && stack.relRoot) return stackChangeAt(cfg, r, stack, frame, at, cache, opts);
  const atCommit = (sha) => cache.get(sha, () => ({
    model: scan(cfg, { files: D.baseFileMap(r.gitRoot, r.relRoot, sha, cfg), churnAt: sha }),
  }));
  const baseModel = atCommit(r.base).model;
  let headModel, renames;
  if (at.apply) {
    const built = cache.get(at.rev, () => {
      const t = applyFrame(r, at, cfg);
      return { model: scan(cfg, { files: t.files, churnAt: at.sha }), renames: t.renames };
    });
    headModel = built.model;
    renames = built.renames;
  } else {
    headModel = at.sha ? atCommit(at.sha).model : (opts.current || scan(cfg));
    renames = renamesBetween(r, at.sha);
  }
  const cmp = compare(baseModel, headModel, renames);
  return {
    model: headModel,
    base: baseModel,
    change: Object.assign({
      label: r.label, base: r.base, head: r.head, set: r.set || null, frame, rev: at.rev || at.sha,
      frames: r.frames.map((f) => ({ sha: f.sha, subject: f.subject, built: !!f.apply })),
    }, cmp, stack && stack.other ? { backendAt: 'current' } : {}),
  };
}

/**
 * Both sides of a stack at each end of the change: the backend read from the
 * same commit as the frontend, and the frontend bridged to it (spec 13).
 */
function stackChangeAt(cfg, r, stack, frame, at, cache, opts) {
  const bridgeTo = (be) => ({ model: be, label: stack.label, cfg: stack.cfg });
  const atCommit = (sha) => cache.get('stack:' + sha, () => {
    const be = scan(stack.cfg, { files: D.baseFileMap(r.gitRoot, stack.relRoot, sha, stack.cfg), churnAt: sha });
    const fe = scan(cfg, { files: D.baseFileMap(r.gitRoot, r.relRoot, sha, cfg), churnAt: sha, backend: bridgeTo(be) });
    return { fe, be };
  });
  const base = atCommit(r.base);
  let head, renames;
  if (at.apply) {
    head = cache.get('stack:' + at.rev, () => {
      const tb = applyFrame(r, at, stack.cfg, stack.relRoot);
      const tf = applyFrame(r, at, cfg);
      const be = scan(stack.cfg, { files: tb.files, churnAt: at.sha });
      const fe = scan(cfg, { files: tf.files, churnAt: at.sha, backend: bridgeTo(be) });
      return { fe, be, renames: { fe: tf.renames, be: tb.renames } };
    });
    renames = head.renames;
  } else {
    if (at.sha) head = atCommit(at.sha);
    else {
      const fe = opts.current && opts.current.__backend ? opts.current : scan(cfg);
      head = { fe, be: fe.__backend.model };
    }
    renames = { fe: renamesBetween(r, at.sha), be: renamesBetween(r, at.sha, stack.relRoot) };
  }
  const cmp = stackCompare(base.fe, head.fe, base.be, head.be, renames);
  return {
    model: head.fe,
    base: base.fe,
    change: Object.assign({
      label: r.label, base: r.base, head: r.head, set: r.set || null, frame, rev: at.rev || at.sha,
      frames: r.frames.map((f) => ({ sha: f.sha, subject: f.subject, built: !!f.apply })),
      stack: true,
    }, cmp),
  };
}

module.exports = { compare, stackCompare, stackOf, resolveChange, changeAt, modelCache };

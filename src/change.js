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
    removed.push({ id, name: b.name, file: b.file, pattern: b.pattern, module: b.module, tier: b.tier });
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

module.exports = { compare };

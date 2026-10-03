'use strict';
/**
 * The bridge (spec 12): each HTTP call a frontend makes, matched to the
 * backend endpoint it reaches.
 *
 * The URL is the call's first argument, read by the React wiring: a string
 * literal or a template. The API client's prefix is stripped, the query
 * ignored, and the rest matched against every endpoint of the same verb,
 * segment by segment:
 *
 *   URL segment      endpoint segment   score
 *   literal          equal literal      2
 *   literal          :param             1
 *   ${hole}          :param             2   a variable meets a variable
 *   ${hole}          literal            1
 *
 * The best score wins. A tie is ambiguous and is reported, not picked.
 *
 * Only served endpoints are matched first. A call that reaches nothing
 * served, but would reach an endpoint whose controller no module lists, is
 * `unserved`: the route is declared, and Nest does not serve it.
 */

const HOLE = '\u0001';

/** A stud's http entry and the call it records: two calls can share a line and a verb. */
const sameCall = (h, c) => h.line === c.line && h.verb === c.verb && h.path === c.path;

/** Path segments of a URL, with the prefix stripped and holes marked. */
function segmentsOf(url, prefix) {
  let u = url.replace(/\$\{[^}]*\}/g, HOLE).split('?')[0].split('#')[0];
  if (prefix && (u === prefix || u.startsWith(prefix + '/'))) u = u.slice(prefix.length);
  u = ('/' + u).replace(/\/+/g, '/').replace(/\/$/, '');
  return u === '' ? [] : u.slice(1).split('/');
}

function score(urlSegs, routeSegs) {
  if (urlSegs.length !== routeSegs.length) return -1;
  let total = 0;
  for (let i = 0; i < urlSegs.length; i++) {
    const u = urlSegs[i], r = routeSegs[i];
    const param = r.startsWith(':');
    if (u === HOLE) total += param ? 2 : 1;
    else if (u.includes(HOLE)) {
      // part literal, part hole (`note-${id}`): a param takes it; a literal must fit
      if (param) total += 1;
      else if (new RegExp('^' + u.split(HOLE).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$').test(r)) total += 1;
      else return -1;
    } else if (param) total += 1;
    else if (u === r) total += 2;
    else return -1;
  }
  return total;
}

/**
 * Match every http call in a frontend model against a backend model's
 * endpoints. Writes the result onto each call and its stud's http entry, and
 * returns the summary.
 */
function bridgeOf(model, backend, cfg, backendLabel) {
  const endpoints = backend.endpoints.map((e) => ({ e, segs: segmentsOf(e.route, null) }));
  const served = endpoints.filter((x) => !x.e.unregistered), unserved = endpoints.filter((x) => x.e.unregistered);
  const out = {
    backend: backendLabel, endpoints: endpoints.length,
    calls: 0, matched: 0, ambiguous: 0, unmatched: 0, unserved: 0, unread: 0,
    reached: 0, unreached: [],
  };
  /** The endpoints of `pool` a call's segments fit best. */
  const bestOf = (pool, verb, segs) => {
    let best = -1, hits = [];
    for (const { e, segs: rs } of pool) {
      if (e.verb !== verb && e.verb !== 'ALL') continue;
      const s = score(segs, rs);
      if (s < 0) continue;
      if (s > best) { best = s; hits = [e]; } else if (s === best) hits.push(e);
    }
    return hits;
  };
  const byId = new Map(model.bricks.map((b) => [b.id, b]));
  const reached = new Set();
  const note = (c, fields) => {
    Object.assign(c, fields);
    const b = byId.get(c.from);
    if (!b) return;
    for (const s of b.studs.concat(b.internals)) {
      for (const h of s.http || []) if (sameCall(h, c)) Object.assign(h, fields);
    }
  };
  for (const c of model.calls) {
    if (c.kind !== 'http') continue;
    out.calls++;
    const file = c.from.split('#')[0];
    // no URL, or no method (a fetch whose method is a variable): unread
    if (c.path === null || c.path === undefined || !c.verb) { note(c, { match: 'unread' }); out.unread++; continue; }
    const segs = segmentsOf(c.path, cfg.apiPrefix || null);
    const hits = bestOf(served, c.verb, segs);
    const dark = hits.length ? [] : bestOf(unserved, c.verb, segs);
    if (dark.length) {
      const e = dark[0];
      note(c, dark.length === 1 ? { match: 'unserved', endpoint: e.id } : { match: 'unserved', candidates: dark.map((x) => x.id) });
      out.unserved++;
      model.diagnostics.push({ kind: 'http-unserved', file, line: c.line,
        detail: `${c.verb} ${c.path} reaches ${e.verb} ${e.route} in ${backendLabel}, whose controller ${e.cls} is in no module's controllers: not served` });
    } else if (!hits.length) {
      note(c, { match: 'unmatched' });
      out.unmatched++;
      model.diagnostics.push({ kind: 'http-unmatched', file, line: c.line,
        detail: `${c.verb} ${c.path} matches no endpoint in ${backendLabel}` });
    } else if (hits.length > 1) {
      note(c, { match: 'ambiguous', candidates: hits.map((e) => e.id) });
      out.ambiguous++;
      model.diagnostics.push({ kind: 'http-ambiguous', file, line: c.line,
        detail: `${c.verb} ${c.path} matches ${hits.length} endpoints equally: ${hits.map((e) => e.verb + ' ' + e.route).join(', ')}` });
    } else {
      const e = hits[0];
      note(c, { match: 'matched', endpoint: e.id, endpointBrick: e.file + '#' + e.cls, endpointMethod: e.handler });
      out.matched++;
      reached.add(e.id);
    }
  }
  out.reached = reached.size;
  out.unreached = backend.endpoints.filter((e) => !reached.has(e.id)).map((e) => e.id);
  return out;
}

module.exports = { bridgeOf, segmentsOf, score, sameCall };

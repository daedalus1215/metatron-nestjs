/**
 * arch-lens scanner — turns a TypeScript source tree into a measured model.
 *
 * Nothing here knows about any particular project. Everything project-shaped
 * comes from the config: which filenames mean which pattern, which tier each
 * pattern belongs to, what the intended call flow is.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ helpers

function walk(dir, ignore, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (ignore.some((re) => re.test(p))) continue;
    if (e.isDirectory()) walk(p, ignore, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function matchParen(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}
/** The `{` that opens a method body, skipping braces inside the return type. */
function bodyStart(src, fromCloseParen) {
  let i = fromCloseParen + 1, ang = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '<') ang++;
    else if (c === '>') { if (ang > 0) ang--; }
    else if (c === '{') {
      if (ang === 0) return i;
      const e = matchBrace(src, i);
      if (e < 0) return -1;
      i = e;
    } else if (c === ';') return -1;
    i++;
  }
  return -1;
}
function splitTop(s) {
  const out = [];
  let d = 0, cur = '';
  for (const ch of s) {
    if ('([{<'.includes(ch)) d++;
    else if (')]}>'.includes(ch)) d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function tarjan(nodeList, adj) {
  let idx = 0;
  const index = {}, low = {}, onstack = {}, stack = [], sccs = [];
  function strong(v) {
    index[v] = low[v] = idx++;
    stack.push(v); onstack[v] = true;
    for (const w of adj[v] || []) {
      if (index[w] === undefined) { strong(w); low[v] = Math.min(low[v], low[w]); }
      else if (onstack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const comp = [];
      let w;
      do { w = stack.pop(); onstack[w] = false; comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  }
  for (const v of nodeList) if (index[v] === undefined) strong(v);
  return sccs;
}

const EXTERNAL_TYPES = new Set([
  'Repository', 'EventEmitter2', 'ConfigService', 'JwtService', 'DataSource',
  'EntityManager', 'Request', 'Response', 'Logger', 'HttpService', 'Model', 'Connection',
]);

// ------------------------------------------------------------------- scanner

module.exports = function scan(cfg, opts = {}) {
  const ROOT = path.resolve(cfg.__dir, cfg.root);
  if (!fs.existsSync(ROOT)) {
    throw new Error(`root not found: ${ROOT}\nSet \`root\` in arch.config.js (it is relative to the config file).`);
  }

  const ignore = cfg.ignore || [];
  const absFiles = walk(ROOT, ignore);
  const text = {};
  for (const abs of absFiles) text[path.relative(ROOT, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
  const files = Object.keys(text);
  const fileSet = new Set(files);
  if (!files.length) throw new Error(`no .ts files under ${ROOT}`);

  // ---- tiers + classification
  const TIERS = cfg.tiers.map((t, i) => ({ i, name: t.name, sub: t.sub || '' }));
  const tierIndex = {};
  TIERS.forEach((t) => { tierIndex[t.name] = t.i; });
  for (const p of cfg.patterns.concat([cfg.fallback])) {
    if (tierIndex[p.tier] === undefined) {
      throw new Error(`pattern "${p.id}" names tier "${p.tier}", which is not in cfg.tiers`);
    }
  }

  function classify(rel) {
    const base = path.basename(rel);
    for (const p of cfg.patterns) {
      const ok = typeof p.test === 'function' ? p.test(rel, base) : p.test.test(rel);
      if (ok) return p;
    }
    return cfg.fallback;
  }

  const moduleOf = cfg.moduleOf || ((rel) => rel.split('/')[0]);
  const info = {};
  for (const rel of files) {
    const p = classify(rel);
    info[rel] = {
      module: moduleOf(rel),
      pattern: p.id,
      tier: tierIndex[p.tier],
      loc: text[rel].split('\n').length,
      layer: folderOf(rel),
    };
  }

  function folderOf(rel) {
    const parts = rel.split('/');
    if (parts.length <= 2) return parts[0] + '/(root)';
    if (parts[2].endsWith('.ts')) return parts[0] + '/' + parts[1];
    return parts[0] + '/' + parts[1] + '/' + parts[2];
  }

  // ---- coverage: the honesty signal for a freshly written config
  const unclassified = files.filter((f) => info[f].pattern === cfg.fallback.id);
  const coverage = {
    files: files.length,
    classified: files.length - unclassified.length,
    unclassifiedCount: unclassified.length,
    unclassifiedPct: +((unclassified.length / files.length) * 100).toFixed(1),
    samples: unclassified.slice(0, 25),
    byPattern: {},
  };
  for (const f of files) coverage.byPattern[info[f].pattern] = (coverage.byPattern[info[f].pattern] || 0) + 1;

  // ---- imports
  function resolveSpec(spec, fromRel) {
    let base;
    const abs = (cfg.absoluteImportPrefix || 'src/');
    if (spec.startsWith(abs)) base = spec.slice(abs.length);
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    } else return null;
    for (const c of [base + '.ts', base + '/index.ts', base]) if (fileSet.has(c)) return c;
    return null;
  }

  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const SYMBOL_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

  const fileEdges = [];
  const externals = {};
  const symbolIndex = {};
  for (const rel of files) {
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(text[rel]))) {
      const t = resolveSpec(m[1], rel);
      if (t) fileEdges.push({ from: rel, to: t });
      else if (!m[1].startsWith('.')) externals[m[1]] = (externals[m[1]] || 0) + 1;
    }
    const map = {};
    SYMBOL_RE.lastIndex = 0;
    while ((m = SYMBOL_RE.exec(text[rel]))) {
      const t = resolveSpec(m[2], rel);
      if (!t) continue;
      for (const raw of m[1].split(',')) {
        const sym = raw.trim().split(/\s+as\s+/).pop().trim();
        if (sym) map[sym] = t;
      }
    }
    symbolIndex[rel] = map;
  }

  // ---- constructor injections
  const injects = {};
  for (const rel of files) {
    const src = text[rel];
    const ci = src.indexOf('constructor(');
    if (ci < 0) { injects[rel] = []; continue; }
    const open = src.indexOf('(', ci);
    const close = matchParen(src, open);
    if (close < 0) { injects[rel] = []; continue; }
    injects[rel] = splitTop(src.slice(open + 1, close)).map((p) => {
      const clean = p.replace(/@\w+\([^)]*\)/g, ' ').replace(/@\w+/g, ' ').trim();
      const m = clean.match(/(?:private|public|protected|readonly|\s)*\s*(\w+)\s*:\s*([A-Za-z_]\w*)/);
      if (!m) return null;
      if (EXTERNAL_TYPES.has(m[2])) return { prop: m[1], type: m[2], file: null };
      return { prop: m[1], type: m[2], file: symbolIndex[rel][m[2]] || null };
    }).filter(Boolean);
  }

  const className = (rel) => {
    const m = text[rel].match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
    return m ? m[1] : path.basename(rel, '.ts');
  };
  function methodSig(rel, name) {
    const src = text[rel];
    const re = new RegExp('(?:^|\\n)\\s*(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?' + name + '\\s*\\(', 'g');
    const m = re.exec(src);
    if (!m) return null;
    const open = src.indexOf('(', m.index);
    const close = matchParen(src, open);
    if (close < 0) return null;
    const bs = bodyStart(src, close);
    const sig = name + '(' + src.slice(open + 1, close).replace(/\s+/g, ' ').trim() + ')' +
      (bs > 0 ? src.slice(close + 1, bs).replace(/\s+/g, ' ').trimEnd() : '');
    return sig.length > 220 ? sig.slice(0, 217) + '...' : sig;
  }
  function methodBody(rel, name) {
    const src = text[rel];
    const re = new RegExp('(?:^|\\n)\\s*(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?' + name + '\\s*\\(', 'g');
    const m = re.exec(src);
    if (!m) return null;
    const open = src.indexOf('(', m.index);
    const close = matchParen(src, open);
    if (close < 0) return null;
    const b = bodyStart(src, close);
    if (b < 0) return null;
    const e = matchBrace(src, b);
    return e < 0 ? null : src.slice(b + 1, e);
  }

  // ---- flow + derived skip rules
  const flow = cfg.flow || [];
  const aliases = cfg.flowAliases || {};
  const station = {};
  flow.forEach((id, i) => {
    station[id] = i;
    for (const a of aliases[id] || []) station[a] = i;
  });
  const skipRules = [];
  for (let i = 0; i < flow.length; i++) {
    for (let j = i + 2; j < flow.length; j++) {
      const jump = j - i - 1;
      skipRules.push({
        id: flow[i] + '>' + flow[j],
        from: flow[i], to: flow[j],
        sev: jump >= 2 ? 'crit' : 'warn',
        jump,
        why: `${label(flow[i])} reaches ${label(flow[j])} directly, skipping ${flow.slice(i + 1, j).map(label).join(' and ')}`,
      });
    }
  }
  function label(id) { return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

  function skipFor(a, b) {
    const sa = station[a], sb = station[b];
    if (sa === undefined || sb === undefined) return null;
    const jump = sb - sa - 1;
    if (jump < 1) return null;
    return skipRules.find((r) => station[r.from] === sa && station[r.to] === sb) || null;
  }

  // ---- folder graph
  const nodes = {};
  for (const rel of files) {
    const i = info[rel];
    const n = nodes[i.layer] || (nodes[i.layer] = { id: i.layer, module: i.module, files: [], tiers: {}, patterns: {} });
    n.files.push({ f: rel, p: i.pattern, loc: i.loc });
    n.tiers[i.tier] = (n.tiers[i.tier] || 0) + 1;
    n.patterns[i.pattern] = (n.patterns[i.pattern] || 0) + 1;
  }
  const platformTier = TIERS.length - 2;
  for (const n of Object.values(nodes)) {
    const entries = Object.entries(n.tiers).map(([t, c]) => [Number(t), c]);
    const core = entries.filter(([t]) => t < platformTier);
    n.tier = (core.length ? core : entries).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    n.count = n.files.length;
    n.label = n.id.split('/').slice(1).join('/') || '(root)';
    n.files.sort((a, b) => a.f.localeCompare(b.f));
  }

  const edgeMap = {};
  for (const e of fileEdges) {
    const a = info[e.from], b = info[e.to];
    if (!a || !b || a.layer === b.layer) continue;
    const k = a.layer + ' ' + b.layer;
    const ed = edgeMap[k] || (edgeMap[k] = { f: a.layer, t: b.layer, w: 0, x: a.module !== b.module ? 1 : 0, s: [] });
    ed.w++;
    if (ed.s.length < 6) ed.s.push({ from: e.from, to: e.to, fp: a.pattern, tp: b.pattern });
  }
  const edges = Object.values(edgeMap);

  const modAgg = {};
  for (const n of Object.values(nodes)) {
    const m = modAgg[n.module] || (modAgg[n.module] = { id: n.module, files: 0, nodes: 0 });
    m.files += n.count;
    m.nodes++;
  }
  const modules = Object.values(modAgg).sort((a, b) => b.files - a.files);

  // ---- module graphs
  const INFRA = new Set(cfg.infraModules || []);
  const SKIP_PAT = new Set(['spec', 'test-util', 'migration', 'bootstrap']);
  function moduleEdgeSet(filter) {
    const out = {};
    for (const e of fileEdges) {
      const a = info[e.from], b = info[e.to];
      if (!a || !b || a.module === b.module) continue;
      if (SKIP_PAT.has(a.pattern) || SKIP_PAT.has(b.pattern)) continue;
      if (!filter(e, a, b)) continue;
      const k = a.module + ' -> ' + b.module;
      const ed = out[k] || (out[k] = { f: a.module, t: b.module, w: 0, ex: [] });
      ed.w++;
      if (ed.ex.length < 4) ed.ex.push(e.from + ' -> ' + e.to);
    }
    return Object.values(out).sort((x, y) => y.w - x.w);
  }
  const allModuleEdges = moduleEdgeSet(() => true);
  const domainEdges = moduleEdgeSet((e, a, b) =>
    a.pattern !== 'module' && b.pattern !== 'port' &&
    !(INFRA.has(a.module) && b.pattern === 'entity'));

  const sccOf = (list) => {
    const adj = {}, ns = new Set();
    for (const e of list) { (adj[e.f] = adj[e.f] || []).push(e.t); ns.add(e.f); ns.add(e.t); }
    return tarjan([...ns], adj).filter((c) => c.length > 1).map((c) => c.sort());
  };
  const fileAdj = {};
  for (const e of fileEdges) (fileAdj[e.from] = fileAdj[e.from] || []).push(e.to);
  const cycles = {
    allEdges: sccOf(allModuleEdges),
    minusWiring: sccOf(moduleEdgeSet((e, a) => a.pattern !== 'module')),
    minusWiringPorts: sccOf(moduleEdgeSet((e, a, b) => a.pattern !== 'module' && b.pattern !== 'port')),
    domain: sccOf(domainEdges),
    files: tarjan(files, fileAdj).filter((c) => c.length > 1).map((c) => c.sort()),
  };

  // ---- cross-domain
  const crossDomain = [];
  const seen = new Set();
  for (const e of fileEdges) {
    const a = info[e.from], b = info[e.to];
    if (!a || !b || a.module === b.module) continue;
    if (SKIP_PAT.has(a.pattern) || SKIP_PAT.has(b.pattern)) continue;
    if (a.pattern === 'module' || b.pattern === 'module') continue;
    if (INFRA.has(a.module) || INFRA.has(b.module)) continue;
    const k = e.from + '|' + e.to;
    if (seen.has(k)) continue;
    seen.add(k);
    crossDomain.push({ f: e.from, t: e.to, fp: a.pattern, tp: b.pattern, fm: a.module, tm: b.module });
  }

  const ports = files.filter((f) => info[f].pattern === 'port').map((p) => ({
    path: p, owner: info[p].module,
    consumers: [...new Set(fileEdges.filter((e) => e.to === p).map((e) => e.from))]
      .map((f) => ({ f, module: info[f].module, pattern: info[f].pattern })),
  }));

  // ---- file graph
  const fileIndex = {};
  files.forEach((f, i) => { fileIndex[f] = i; });
  const fileNodes = files.map((f) => ({
    f, m: info[f].module, p: info[f].pattern, t: info[f].tier, loc: info[f].loc,
    cls: /class\s/.test(text[f]) ? className(f) : null,
  }));
  const seenLink = new Set();
  const fileLinks = [];
  for (const e of fileEdges) {
    const a = info[e.from], b = info[e.to];
    if (!a || !b) continue;
    const k = e.from + '|' + e.to;
    if (seenLink.has(k)) continue;
    seenLink.add(k);
    const rule = skipFor(a.pattern, b.pattern);
    fileLinks.push([fileIndex[e.from], fileIndex[e.to], a.module !== b.module ? 1 : 0,
      rule ? rule.id : (a.tier === b.tier ? 'same' : 'ok')]);
  }

  // ---- endpoints + traces
  const endpoints = [];
  const VERB_RE = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
  const entryPatterns = new Set(['action', 'controller', 'resolver'].filter((p) => cfg.patterns.some((x) => x.id === p)));
  for (const rel of files) {
    if (!entryPatterns.has(info[rel].pattern)) continue;
    const src = text[rel];
    const cm = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]?\s*\)/);
    const prefix = cm ? cm[1] : '';
    const cls = className(rel);
    VERB_RE.lastIndex = 0;
    let m;
    while ((m = VERB_RE.exec(src))) {
      const verb = m[1].toUpperCase(), sub = m[2] || '';
      const after = src.slice(m.index + m[0].length);
      const hm = after.match(/\n\s{2}(?:public\s+|private\s+)?(?:async\s+)?(\w+)\s*\(/);
      if (!hm) continue;
      const handler = hm[1];
      const openIdx = m.index + m[0].length + hm.index + hm[0].length - 1;
      const closeIdx = matchParen(src, openIdx);
      if (closeIdx < 0) continue;
      const bStart = bodyStart(src, closeIdx);
      const retM = bStart > 0 ? src.slice(closeIdx + 1, bStart).match(/:\s*([\s\S]+)/) : null;
      const ret = retM ? retM[1].trim().replace(/\s+/g, ' ') : 'void';
      const bClose = bStart > 0 ? matchBrace(src, bStart) : -1;
      const body = bStart > 0 && bClose > 0 ? src.slice(bStart + 1, bClose).replace(/^\n/, '').trimEnd() : '';
      const params = splitTop(src.slice(openIdx + 1, closeIdx)).map((p) => {
        const dm = p.match(/@(\w+)\(([^)]*)\)/);
        const tm = p.replace(/@\w+\([^)]*\)/g, '').match(/(\w+)\s*:\s*([\s\S]+)/);
        return {
          deco: dm ? dm[1] : null, decoArg: dm ? dm[2].replace(/['"]/g, '') : null,
          name: tm ? tm[1] : p.trim(), type: tm ? tm[2].trim().replace(/\s+/g, ' ') : '',
        };
      });
      const bodyParam = params.find((p) => p.deco === 'Body');
      const dtoType = bodyParam ? (bodyParam.type.match(/[A-Za-z_]\w*/) || [])[0] : null;
      const dtoFile = dtoType ? symbolIndex[rel][dtoType] : null;
      const retType = (ret.match(/[A-Za-z_]\w*/g) || [])
        .filter((t) => !['Promise', 'Array', 'void', 'string', 'number', 'boolean', 'any'].includes(t))[0];
      const retFile = retType ? symbolIndex[rel][retType] : null;
      const classBody = (f) => {
        const s2 = text[f];
        const mm = s2.match(/export\s+(?:abstract\s+)?class\s+\w+[^{]*\{/);
        if (!mm) return '';
        const o = s2.indexOf('{', mm.index), c = matchBrace(s2, o);
        return c < 0 ? '' : s2.slice(mm.index, c + 1);
      };
      const fieldsOf = (f) => {
        const out = [];
        const re = /@(Column|PrimaryGeneratedColumn|PrimaryColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|ManyToOne|OneToMany|OneToOne|ManyToMany|JoinColumn|JoinTable|Prop)\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*\n?\s*(\w+)[?!]?\s*:\s*([^;]+);/g;
        let mm;
        while ((mm = re.exec(text[f]))) out.push({ deco: mm[1], name: mm[3], type: mm[4].trim().replace(/\s+/g, ' ') });
        return out;
      };
      endpoints.push({
        id: verb + ' /' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '') + '#' + handler,
        verb, route: '/' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, ''),
        handler, cls, file: rel, module: info[rel].module,
        params, ret, body: body.split('\n').slice(0, 18).join('\n'),
        dto: dtoFile ? { type: dtoType, file: dtoFile, src: (classBody(dtoFile) || text[dtoFile]).split('\n').slice(0, 40).join('\n') }
          : (dtoType ? { type: dtoType, file: null, src: null } : null),
        returns: retFile ? {
          type: retType, file: retFile, kind: info[retFile].pattern,
          fields: info[retFile].pattern === 'entity' ? fieldsOf(retFile) : null,
          src: info[retFile].pattern === 'entity' ? null : classBody(retFile).split('\n').slice(0, 40).join('\n'),
        } : { type: retType || 'void', file: null },
      });
    }
  }

  function trace(rel, method, seenKeys, depth) {
    if (depth > 5) return [];
    const body = methodBody(rel, method);
    const mine = injects[rel] || [];
    const calls = [];
    if (body) {
      const re = /this\.(\w+)\.(\w+)\s*\(/g;
      let m;
      while ((m = re.exec(body))) {
        if (!calls.some((c) => c.prop === m[1] && c.method === m[2])) calls.push({ prop: m[1], method: m[2] });
      }
    }
    const out = [];
    for (const c of calls) {
      const inj = mine.find((i) => i.prop === c.prop);
      if (!inj || !inj.file) continue;
      const key = inj.file + '#' + c.method;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({
        file: inj.file, cls: className(inj.file), kind: info[inj.file].pattern,
        tier: info[inj.file].tier, module: info[inj.file].module,
        method: c.method, prop: c.prop, sig: methodSig(inj.file, c.method),
        children: trace(inj.file, c.method, seenKeys, depth + 1),
      });
    }
    if (!out.length && depth === 0) {
      for (const inj of mine) {
        if (!inj.file) continue;
        const k = info[inj.file].pattern;
        if (k === 'dto' || k === 'entity') continue;
        out.push({
          file: inj.file, cls: className(inj.file), kind: k, tier: info[inj.file].tier,
          module: info[inj.file].module, method: null, prop: inj.prop, sig: null,
          children: [], inferred: true,
        });
      }
    }
    return out;
  }
  const flatten = (list, acc, d) => {
    for (const n of list) {
      acc.push({ file: n.file, cls: n.cls, kind: n.kind, tier: n.tier, module: n.module,
        method: n.method, prop: n.prop, sig: n.sig, depth: d, inferred: !!n.inferred });
      flatten(n.children, acc, d + 1);
    }
    return acc;
  };
  for (const e of endpoints) e.flat = flatten(trace(e.file, e.handler, new Set([e.file + '#' + e.handler]), 0), [], 1);
  endpoints.sort((a, b) => a.module.localeCompare(b.module) || a.route.localeCompare(b.route) || a.verb.localeCompare(b.verb));

  // ---- findings
  const pairs = (fp, tp) => fileEdges.filter((e) => info[e.from] && info[e.to] && info[e.from].pattern === fp && info[e.to].pattern === tp);
  const findings = [];

  const nonGateway = crossDomain.filter((e) => !(cfg.crossDomainGateways || []).includes(e.tp));
  findings.push({
    id: 'cross-domain', tone: nonGateway.length ? 'warn' : 'good',
    title: nonGateway.length
      ? `${nonGateway.length} cross-domain imports bypass the allowed gateways`
      : 'Every cross-domain edge goes through an allowed gateway',
    detail: `${crossDomain.length} dependencies cross a bounded context. Allowed landing points: ${(cfg.crossDomainGateways || []).join(', ') || '(none configured)'}.`,
    items: (nonGateway.length ? nonGateway : crossDomain).map((e) => `${e.fm}/${e.fp} -> ${e.t}`),
  });

  findings.push({
    id: 'dag', tone: cycles.domain.length ? 'warn' : 'good',
    title: cycles.domain.length ? 'Domain dependency graph has cycles' : 'Domain dependency graph is acyclic',
    detail: 'Strongly-connected components as sanctioned carve-outs are removed in turn.',
    items: [
      `all import edges: ${cycles.allEdges.length} SCC(s)`,
      `minus wiring: ${cycles.minusWiring.length} SCC(s)`,
      `minus wiring + ports: ${cycles.minusWiringPorts.length} SCC(s)`,
      `minus wiring + ports + infra entities: ${cycles.domain.length} SCC(s)`,
    ],
  });

  // Two files of the same pattern inside one folder is a helper split, not a
  // same-level injection. Only a cross-folder pair breaks the rule.
  const same = fileEdges.filter((e) => {
    const a = info[e.from], b = info[e.to];
    return a && b && a.pattern === b.pattern && (cfg.noSameLevel || []).includes(a.pattern) &&
      e.from !== e.to && a.layer !== b.layer;
  });
  const sameInFolder = fileEdges.filter((e) => {
    const a = info[e.from], b = info[e.to];
    return a && b && a.pattern === b.pattern && (cfg.noSameLevel || []).includes(a.pattern) &&
      e.from !== e.to && a.layer === b.layer;
  });
  findings.push({
    id: 'no-same-level', tone: same.length ? 'warn' : 'good',
    title: same.length ? `${same.length} same-level injections across folders` : 'No same-level injection',
    detail: `Checked among ${(cfg.noSameLevel || []).join(', ')}.` +
      (sameInFolder.length ? ` ${sameInFolder.length} same-pattern import(s) sit inside one folder and are treated as a helper split, not a violation.` : ''),
    items: (same.length ? same : sameInFolder).map((e) => `[${info[e.from].pattern}] ${e.from} -> ${e.to}`),
  });

  const upward = [];
  for (const r of cfg.forbidden || []) {
    for (const e of pairs(r.from, r.to)) upward.push(`${r.why}: ${e.from} -> ${e.to}`);
  }
  findings.push({
    id: 'no-upward', tone: upward.length ? 'warn' : 'good',
    title: upward.length ? `${upward.length} upward calls` : 'No upward calls',
    detail: 'Layering holds in the direction the rules require.',
    items: upward.length ? upward : (cfg.forbidden || []).map((r) => `${r.from} -> ${r.to}: 0`),
  });

  for (const r of skipRules) {
    const hits = pairs(r.from, r.to);
    if (!hits.length) continue;
    findings.push({
      id: r.id, tone: 'warn', title: r.why,
      detail: `Intended flow is ${flow.join(' -> ')}.`,
      items: hits.map((e) => `${e.from}  ->  ${e.to}`),
    });
  }

  for (const n of cfg.naming || []) {
    const hits = files.filter((f) => (typeof n.test === 'function' ? n.test(f) : n.test.test(f)));
    if (!hits.length) continue;
    findings.push({ id: 'naming-' + n.id, tone: 'warn', title: n.title, detail: n.why || '', items: hits });
  }

  const appDirs = [...new Set(files.map((f) => f.split('/').slice(0, 2).join('/')).filter((p) => /\/apps?$/.test(p)))].sort();
  if (appDirs.some((d) => d.endsWith('/app')) && appDirs.some((d) => d.endsWith('/apps'))) {
    findings.push({
      id: 'app-apps', tone: 'warn', title: 'app/ and apps/ used interchangeably',
      detail: 'Tooling that globs one spelling silently misses the other.', items: appDirs,
    });
  }

  const deadShims = files.filter((f) => {
    const b = text[f].trim();
    return /^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?$/.test(b) && !fileEdges.some((e) => e.to === f);
  });
  if (deadShims.length) {
    findings.push({
      id: 'dead-shims', tone: 'warn', title: 'Dead re-export files',
      detail: 'Single-line re-exports that nothing imports.', items: deadShims,
    });
  }

  if (cycles.files.length) {
    findings.push({
      id: 'circular', tone: 'warn', title: 'Circular imports between files',
      detail: 'Mutually importing files — genuine runtime cycles.',
      items: cycles.files.map((c) => c.join('  <->  ')),
    });
  }

  const absent = (cfg.patterns || []).filter((p) => !files.some((f) => info[f].pattern === p.id));
  if (absent.length) {
    findings.push({
      id: 'absent-patterns', tone: 'note',
      title: `${absent.length} configured patterns exist nowhere in the code`,
      detail: 'Either the architecture document describes shapes that were never built, or the config names patterns this project does not use.',
      items: absent.map((p) => `${p.id} (tier ${p.tier})`),
    });
  }

  const shape = {};
  for (const f of files) {
    (shape[info[f].module] = shape[info[f].module] || {});
    shape[info[f].module][info[f].pattern] = (shape[info[f].module][info[f].pattern] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    project: cfg.name || path.basename(path.resolve(cfg.__dir)),
    root: cfg.root,
    flow, skipRules, coverage,
    stats: {
      files: files.length, edges: fileEdges.length, nodes: Object.keys(nodes).length,
      externals: Object.keys(externals).length, endpoints: endpoints.length,
      hops: endpoints.reduce((a, e) => a + e.flat.length, 0),
    },
    tiers: TIERS,
    nodes: Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id)),
    edges, modules,
    domainModules: modules.map((m) => m.id).filter((m) => !INFRA.has(m) && m !== '(root)'),
    platformModules: modules.map((m) => m.id).filter((m) => INFRA.has(m) || m === '(root)'),
    allModuleEdges, domainEdges, cycles, crossDomain, ports, endpoints, shape, findings,
    fileNodes, fileLinks,
  };
};

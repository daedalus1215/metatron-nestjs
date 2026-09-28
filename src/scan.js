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
const { execFileSync } = require('child_process');
const { violationsOf } = require('./violations');

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

/** 1-based line number of a character offset, for diagnostics. */
function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

/** The `{` opening the object literal that encloses offset `idx`, or -1. */
function enclosingBrace(src, idx) {
  let d = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (src[i] === '}') d++;
    else if (src[i] === '{') { if (d === 0) return i; d--; }
  }
  return -1;
}

/**
 * The first method declaration at or after `from`, skipping comments and any
 * number of further decorators — whose arguments may contain arbitrary nesting,
 * so they are brace-matched rather than pattern-matched.
 *
 * Indentation is never consulted. The previous implementation scanned for a
 * two-space-indented method shape, and because `String.match` runs forward
 * until something matches, a four-space file bound the route to an unrelated
 * method further down instead of failing.
 */
function nextMethodAfter(src, from) {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl < 0) return null; i = nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 2; continue; }
    if (c === '@') {
      i++;
      while (i < src.length && /[\w$.]/.test(src[i])) i++;
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '(') { const e = matchParen(src, j); if (e < 0) return null; i = e + 1; }
      continue;
    }
    const rest = src.slice(i, i + 400);
    const mod = rest.match(/^(public|private|protected|readonly|static|async|override|abstract)\b/);
    if (mod) { i += mod[1].length; continue; }
    const nm = rest.match(/^([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/);
    if (!nm) return null;   // a property, a closing brace, anything that is not a method
    return { name: nm[1], open: i + nm[0].length - 1 };
  }
  return null;
}

/** @Controller(), @Controller('notes') and @Controller({ path: 'notes' }). */
function controllerPrefix(src) {
  const m = src.match(/@Controller\s*\(/);
  if (!m) return { prefix: '', at: 0 };
  const open = src.indexOf('(', m.index);
  const close = matchParen(src, open);
  if (close < 0) return { prefix: '', at: m.index, unresolved: true };
  const raw = src.slice(open + 1, close).trim();
  if (!raw) return { prefix: '', at: m.index };
  const str = raw.match(/^['"`]([^'"`]*)['"`]$/);
  if (str) return { prefix: str[1], at: m.index };
  const obj = raw.match(/(?:^|[{,\s])path\s*:\s*['"`]([^'"`]*)['"`]/);
  if (obj) return { prefix: obj[1], at: m.index };
  return { prefix: '', at: m.index, unresolved: true };
}

/**
 * A route argument we are willing to interpret: nothing, or one plain string.
 * An array (`@Get(['a','b'])`) or a computed value is reported, not guessed at.
 */
function routeArg(raw) {
  const t = raw.trim();
  if (!t) return { sub: '', ok: true };
  const str = t.match(/^['"`]([^'"`]*)['"`]$/);
  if (str) return { sub: str[1], ok: true };
  return { sub: null, ok: false };
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

  // Anything we decline to interpret is recorded here rather than dropped. A
  // route that vanished silently is how the indentation bug stayed hidden, and a
  // port we cannot follow must say so rather than end a trace unannounced.
  const diagnostics = [];

  // ---- provider bindings
  //
  // A port is injected as an interface, which has no method bodies, so a trace
  // that reaches one stops there. The class Nest actually binds to the token is
  // named in a module file. The table is global rather than per-module, because
  // a token is often injected in one module and provided in another.
  const declaresClass = (rel, name) =>
    new RegExp('(?:^|\\n)\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+' + name + '\\b').test(text[rel]);
  const declaresConst = (rel, name) =>
    new RegExp('(?:^|\\n)\\s*(?:export\\s+)?const\\s+' + name + '\\b').test(text[rel]);

  /** A token as written in `rel`: a string literal, or a symbol resolved to the file declaring it. */
  function tokenOf(rel, raw) {
    const str = raw.match(/^['"]([^'"]*)['"]$/);
    if (str) return { name: str[1], key: 'str:' + str[1], file: null };
    const file = symbolIndex[rel][raw] || (declaresConst(rel, raw) || declaresClass(rel, raw) ? rel : null);
    return { name: raw, key: file ? file + '#' + raw : 'ext:' + raw, file };
  }

  const bindings = [];
  const bindingsByKey = {};
  const PROVIDE_RE = /\bprovide\s*:\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/g;
  for (const rel of files) {
    if (info[rel].pattern !== 'module') continue;
    const src = text[rel];
    PROVIDE_RE.lastIndex = 0;
    let m;
    while ((m = PROVIDE_RE.exec(src))) {
      // Read the enclosing object literal rather than splitting the providers
      // array: splitTop counts the `>` of a `useFactory: () =>` arrow as a
      // closing bracket, and would lose every provider after it.
      const open = enclosingBrace(src, m.index);
      const close = open < 0 ? -1 : matchBrace(src, open);
      if (close < 0) continue;
      const use = src.slice(open, close + 1).match(/\b(useClass|useExisting|useValue|useFactory)\s*:\s*([A-Za-z_$][\w$]*)?/);
      if (!use) continue;
      const tok = tokenOf(rel, m[1]);
      const cls = use[1] === 'useClass' || use[1] === 'useExisting' ? use[2] || null : null;
      const impl = cls ? symbolIndex[rel][cls] || (declaresClass(rel, cls) ? rel : null) : null;
      const b = { token: tok.name, tokenFile: tok.file, impl, cls, via: use[1], module: rel, line: lineOf(src, m.index) };
      bindings.push(b);
      (bindingsByKey[tok.key] = bindingsByKey[tok.key] || []).push(b);
    }
  }

  /**
   * Record where an `@Inject(TOKEN)` parameter is bound. `inj.file` keeps
   * pointing at the declared type — the import of the port is real and stays in
   * the graph — and `boundTo` is added knowledge, not a replacement.
   */
  function bindInjection(rel, inj, raw, line) {
    const tok = tokenOf(rel, raw);
    inj.token = tok.name;
    const report = (kind, detail) => diagnostics.push({ kind, file: rel, line, token: tok.name, detail });
    // Providing one token the same way in two modules is not a conflict.
    const found = [...new Map((bindingsByKey[tok.key] || [])
      .map((b) => [b.via + '|' + (b.impl || b.cls), b])).values()];
    if (found.length > 1) {
      // Nest settles this by module scope, which this scanner does not model,
      // and a coin-flip would be worse than an admission.
      report('port-ambiguous', `${tok.name} is bound differently in ${found.length} places (` +
        found.map((b) => `${b.cls || b.via} in ${b.module}`).join(', ') + `) — trace stops at ${inj.type}`);
      return;
    }
    const b = found[0];
    if (b && b.impl) {
      Object.assign(inj, { boundTo: b.impl, boundVia: b.via, boundIn: b.module });
      return;
    }
    // useValue is data rather than an implementation: nothing to follow, and
    // nothing worth reporting.
    if (b && b.via === 'useFactory') {
      // A factory can return anything; following it would be a guess.
      report('port-unbound', `${tok.name} is provided by useFactory in ${b.module} — not followed, trace stops at ${inj.type}`);
    } else if (b && b.cls) {
      report('port-unbound', `${tok.name} is bound to ${b.cls}, which is outside the scanned tree`);
    } else if (!b && tok.file && !declaresClass(tok.file, tok.name)) {
      // Only a token declared in this tree can be known to be missing. A string
      // or package token may be provided by a module we never see, and a class
      // used as its own token is ordinary DI, already resolved by its type.
      report('port-unbound', `no module provides ${tok.name} — trace stops at ${inj.type}`);
    }
  }

  // ---- constructor injections
  const injects = {};
  const INJECT_RE = /@Inject\s*\(\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*\)/;
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
      const inj = { prop: m[1], type: m[2], file: EXTERNAL_TYPES.has(m[2]) ? null : symbolIndex[rel][m[2]] || null };
      const tm = p.match(INJECT_RE);
      if (tm) bindInjection(rel, inj, tm[1], lineOf(src, src.indexOf(p, open)));
      return inj;
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
  //
  // A route decorator binds to the first method declaration that follows it.
  // Anything we cannot bind is recorded in `diagnostics` rather than dropped.
  const endpoints = [];
  const VERB_SCAN = /@(Get|Post|Put|Patch|Delete|All|Head|Options)\s*\(/g;
  const entryPatterns = new Set(['action', 'controller', 'resolver'].filter((p) => cfg.patterns.some((x) => x.id === p)));
  for (const rel of files) {
    if (!entryPatterns.has(info[rel].pattern)) continue;
    const src = text[rel];
    const ctrl = controllerPrefix(src);
    if (ctrl.unresolved) {
      diagnostics.push({
        kind: 'controller-prefix-unresolved', file: rel, line: lineOf(src, ctrl.at),
        detail: 'unrecognised @Controller() argument — routes in this file may be reported at the wrong path',
      });
    }
    const prefix = ctrl.prefix;
    const cls = className(rel);
    VERB_SCAN.lastIndex = 0;
    let m;
    while ((m = VERB_SCAN.exec(src))) {
      const verb = m[1].toUpperCase();
      const decoOpen = m.index + m[0].length - 1;
      const decoClose = matchParen(src, decoOpen);
      if (decoClose < 0) {
        diagnostics.push({
          kind: 'route-arg-unrecognised', file: rel, line: lineOf(src, m.index),
          detail: `@${m[1]}( has no matching close paren — endpoint skipped`,
        });
        continue;
      }
      VERB_SCAN.lastIndex = decoClose + 1;   // never re-enter the decorator's own arguments
      const raw = src.slice(decoOpen + 1, decoClose);
      const arg = routeArg(raw);
      if (!arg.ok) {
        diagnostics.push({
          kind: 'route-arg-unrecognised', file: rel, line: lineOf(src, m.index),
          detail: `@${m[1]}(${raw.trim().slice(0, 40)}) is not a plain string — endpoint skipped`,
        });
        continue;
      }
      const sub = arg.sub;
      const meth = nextMethodAfter(src, decoClose + 1);
      if (!meth) {
        diagnostics.push({
          kind: 'handler-unresolved', file: rel, line: lineOf(src, m.index),
          detail: `@${m[1]}(${sub ? "'" + sub + "'" : ''}) is not followed by a method declaration`,
        });
        continue;
      }
      const handler = meth.name;
      const openIdx = meth.open;
      const closeIdx = matchParen(src, openIdx);
      if (closeIdx < 0) {
        diagnostics.push({
          kind: 'handler-unresolved', file: rel, line: lineOf(src, m.index),
          detail: `parameter list of ${handler}() is unbalanced`,
        });
        continue;
      }
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
      // A port has no method bodies; continue into the class its module binds.
      const tgt = inj && (inj.boundTo || inj.file);
      if (!tgt) continue;
      const key = tgt + '#' + c.method;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push(Object.assign({
        file: tgt, cls: className(tgt), kind: info[tgt].pattern,
        tier: info[tgt].tier, module: info[tgt].module,
        method: c.method, prop: c.prop, sig: methodSig(tgt, c.method),
      }, viaPortOf(inj), {
        children: trace(tgt, c.method, seenKeys, depth + 1),
      }));
    }
    if (!out.length && depth === 0) {
      for (const inj of mine) {
        const tgt = inj.boundTo || inj.file;
        if (!tgt) continue;
        const k = info[tgt].pattern;
        if (k === 'dto' || k === 'entity') continue;
        out.push(Object.assign({
          file: tgt, cls: className(tgt), kind: k, tier: info[tgt].tier,
          module: info[tgt].module, method: null, prop: inj.prop, sig: null,
        }, viaPortOf(inj), { children: [], inferred: true }));
      }
    }
    return out;
  }
  // The indirection is architecturally meaningful and must not be erased: a
  // hop that crossed a binding says which port it went through. Only such hops
  // carry these fields, so every other hop keeps its shape.
  function viaPortOf(inj) {
    return inj.boundTo ? { viaPort: inj.type, token: inj.token, boundIn: inj.boundIn } : {};
  }
  const flatten = (list, acc, d) => {
    for (const n of list) {
      const hop = { file: n.file, cls: n.cls, kind: n.kind, tier: n.tier, module: n.module,
        method: n.method, prop: n.prop, sig: n.sig, depth: d, inferred: !!n.inferred };
      if (n.viaPort) Object.assign(hop, { viaPort: n.viaPort, token: n.token, boundIn: n.boundIn });
      acc.push(hop);
      flatten(n.children, acc, d + 1);
    }
    return acc;
  };
  for (const e of endpoints) e.flat = flatten(trace(e.file, e.handler, new Set([e.file + '#' + e.handler]), 0), [], 1);
  endpoints.sort((a, b) => a.module.localeCompare(b.module) || a.route.localeCompare(b.route) || a.verb.localeCompare(b.verb));

  // ---- churn, from git history
  //
  // How often a file changes, crossed with how much depends on it, is the
  // classic argument for where refactoring pays. Silently skipped outside a
  // git repo, or when `since` finds no commits.

  const churn = {};
  let churnMeta = { available: false, commits: 0, since: cfg.churnSince || null, reason: null };
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const args = ['log', '--no-merges', '--numstat', '--format=%x01%H%x02%at%x02%an'];
    if (cfg.churnSince) args.push('--since=' + cfg.churnSince);
    args.push('--', ROOT);
    const out = execFileSync('git', args, { cwd: gitRoot, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

    let when = 0, who = null, commits = 0;
    for (const line of out.split('\n')) {
      if (line.startsWith('\u0001')) {
        const parts = line.slice(1).split('\u0002');
        when = Number(parts[1]) * 1000;
        who = parts[2];
        commits++;
        continue;
      }
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      let file = m[3];
      // renames arrive as "old => new" or "dir/{old => new}/x"
      if (file.includes(' => ')) {
        file = file.replace(/\{([^}]*) => ([^}]*)\}/, '$2').replace(/^.* => /, '');
      }
      const abs = path.resolve(gitRoot, file);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (!fileSet.has(rel)) continue;
      const c = churn[rel] || (churn[rel] = { commits: 0, added: 0, removed: 0, last: 0, first: Infinity, authors: {} });
      c.commits++;
      c.added += m[1] === '-' ? 0 : Number(m[1]);
      c.removed += m[2] === '-' ? 0 : Number(m[2]);
      if (when > c.last) c.last = when;
      if (when < c.first) c.first = when;
      if (who) c.authors[who] = (c.authors[who] || 0) + 1;
    }
    for (const k of Object.keys(churn)) {
      churn[k].authorCount = Object.keys(churn[k].authors).length;
      delete churn[k].authors;
      if (churn[k].first === Infinity) churn[k].first = 0;
    }
    churnMeta = { available: Object.keys(churn).length > 0, commits, since: cfg.churnSince || null, reason: null };
    if (!churnMeta.available) churnMeta.reason = 'git history touched none of the scanned files';
  } catch (err) {
    churnMeta = { available: false, commits: 0, since: cfg.churnSince || null, reason: 'not a git repository, or git unavailable' };
  }

  // ---- data model: entities, their columns, and the references between them
  //
  // Declaring a TypeORM relation across a bounded context couples the two
  // contexts, so plenty of codebases deliberately store a bare `<thing>Id`
  // column instead. Those references are real but invisible to the ORM, so we
  // infer them from column names as well as reading the decorators.

  const COL_RE = /@(Column|PrimaryGeneratedColumn|PrimaryColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*\n?\s*(\w+)([?!])?\s*:\s*([^;]+);/g;
  const REL_RE = /@(ManyToOne|OneToMany|OneToOne|ManyToMany)\(\s*(?:\(\s*\)|\w+)\s*=>\s*(\w+)/g;
  const TABLE_RE = /@Entity\(\s*['"`]([^'"`]+)['"`]/;

  const singular = (w) => w.replace(/ies$/, 'y').replace(/ses$/, 's').replace(/s$/, '');
  const norm = (w) => singular(String(w).toLowerCase().replace(/[^a-z0-9]/g, ''));

  const entities = files.filter((f) => info[f].pattern === 'entity').map((f) => {
    const src = text[f];
    const cls = className(f);
    const table = (src.match(TABLE_RE) || [])[1] || null;
    const columns = [];
    COL_RE.lastIndex = 0;
    let m;
    while ((m = COL_RE.exec(src))) {
      columns.push({
        name: m[3], type: m[5].trim().replace(/\s+/g, ' '),
        deco: m[1], nullable: m[4] === '?' || /\bnull\b/.test(m[5]),
        pk: /Primary/.test(m[1]),
      });
    }
    return { file: f, cls, table, module: info[f].module, columns };
  });

  // every name an entity might be referred to by
  const byName = {};
  for (const e of entities) {
    byName[norm(e.cls)] = e;
    if (e.table) byName[norm(e.table)] = e;
  }

  const relations = [];
  const seenRel = new Set();
  function addRel(from, to, via, declared, kind) {
    if (!from || !to) return;
    const key = from.cls + '|' + to.cls + '|' + via;
    if (seenRel.has(key)) return;
    seenRel.add(key);
    relations.push({
      from: from.cls, fromModule: from.module, to: to.cls, toModule: to.module,
      via, declared, kind: kind || null,
      cross: from.module !== to.module,
      self: from.cls === to.cls,
    });
  }

  for (const e of entities) {
    // declared, from the decorators
    REL_RE.lastIndex = 0;
    let m;
    while ((m = REL_RE.exec(text[e.file]))) {
      const target = entities.find((x) => x.cls === m[2]);
      if (target) addRel(e, target, m[1], true, m[1]);
    }
    // inferred, from `<thing>Id` columns
    for (const c of e.columns) {
      const stem = c.name.match(/^(.*?)(?:Id|_id)$/);
      if (!stem || !stem[1]) continue;
      const target = byName[norm(stem[1])] ||
        (/^parent$/i.test(stem[1]) ? e : null);   // parentId is a self-reference
      if (!target) continue;
      addRel(e, target, c.name, false, 'implicit');
    }
  }

  // A TypeORM relation is normally written twice: the decorator and the id
  // column beside it. That is one relationship, so fold the implicit reading
  // into the declared one when the column plainly names the same target.
  const merged = [];
  for (const r of relations) {
    if (r.declared) { merged.push(r); continue; }
    const stem = (r.via.match(/^(.*?)(?:Id|_id)$/) || [])[1];
    const twin = relations.find((d) =>
      d.declared && d.from === r.from && d.to === r.to && stem && norm(stem) === norm(d.to));
    if (twin) { twin.via = r.via; continue; }   // keep the column name, it is the useful half
    merged.push(r);
  }
  relations.length = 0;
  relations.push(...merged);

  const dataModel = {
    entities,
    relations,
    stats: {
      entities: entities.length,
      columns: entities.reduce((a, e) => a + e.columns.length, 0),
      declared: relations.filter((r) => r.declared).length,
      inferred: relations.filter((r) => !r.declared).length,
      crossContext: relations.filter((r) => r.cross).length,
      untabled: entities.filter((e) => !e.table).length,
    },
  };

  // ---- orphans: nothing reaches these from a route or a module registration
  const reach = new Set();
  const stack = [];
  const adjOut = {};
  for (const e of fileEdges) (adjOut[e.from] = adjOut[e.from] || []).push(e.to);
  for (const f of files) {
    if (info[f].pattern === 'module' || endpoints.some((e) => e.file === f)) {
      if (!reach.has(f)) { reach.add(f); stack.push(f); }
    }
  }
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of adjOut[cur] || []) if (!reach.has(nb)) { reach.add(nb); stack.push(nb); }
  }
  const IGNORE_ORPHAN = new Set(['spec', 'test-util', 'migration', 'bootstrap', 'module']);
  const orphans = files.filter((f) => !reach.has(f) && !IGNORE_ORPHAN.has(info[f].pattern));

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
    instances: nonGateway.map((e) => ({ from: e.f, to: e.t })),
  });

  findings.push({
    id: 'dag', tone: cycles.domain.length ? 'warn' : 'good', gate: false,
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
    instances: same.map((e) => ({ from: e.from, to: e.to })),
  });

  const upward = [];
  for (const r of cfg.forbidden || []) {
    for (const e of pairs(r.from, r.to)) upward.push({ from: e.from, to: e.to, why: r.why });
  }
  findings.push({
    id: 'no-upward', tone: upward.length ? 'warn' : 'good',
    title: upward.length ? `${upward.length} upward calls` : 'No upward calls',
    detail: 'Layering holds in the direction the rules require.',
    items: upward.length
      ? upward.map((u) => `${u.why}: ${u.from} -> ${u.to}`)
      : (cfg.forbidden || []).map((r) => `${r.from} -> ${r.to}: 0`),
    instances: upward.map((u) => ({ from: u.from, to: u.to })),
  });

  for (const r of skipRules) {
    const hits = pairs(r.from, r.to);
    if (!hits.length) continue;
    findings.push({
      id: r.id, tone: 'warn', title: r.why,
      detail: `Intended flow is ${flow.join(' -> ')}.`,
      items: hits.map((e) => `${e.from}  ->  ${e.to}`),
      instances: hits.map((e) => ({ from: e.from, to: e.to })),
    });
  }

  for (const n of cfg.naming || []) {
    const hits = files.filter((f) => (typeof n.test === 'function' ? n.test(f) : n.test.test(f)));
    if (!hits.length) continue;
    findings.push({
      id: 'naming-' + n.id, tone: 'warn', title: n.title, detail: n.why || '', items: hits,
      instances: hits.map((f) => ({ from: f, to: '' })),
    });
  }

  const appDirs = [...new Set(files.map((f) => f.split('/').slice(0, 2).join('/')).filter((p) => /\/apps?$/.test(p)))].sort();
  if (appDirs.some((d) => d.endsWith('/app')) && appDirs.some((d) => d.endsWith('/apps'))) {
    findings.push({
      id: 'app-apps', tone: 'warn', gate: false, title: 'app/ and apps/ used interchangeably',
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
      instances: deadShims.map((f) => ({ from: f, to: '' })),
    });
  }

  if (orphans.length) {
    findings.push({
      id: 'orphans', tone: 'warn',
      title: `${orphans.length} files are unreachable from any route or module`,
      detail: 'Walking imports outward from every HTTP handler and every *.module.ts registration never arrives at these. Likely dead.',
      items: orphans,
      instances: orphans.map((f) => ({ from: f, to: '' })),
    });
  }

  if (dataModel.stats.inferred) {
    findings.push({
      id: 'implicit-fk', tone: 'note',
      title: `${dataModel.stats.inferred} entity references are implicit`,
      detail: `The data model has ${relations.length} references between entities; ${dataModel.stats.declared} are declared to the ORM and ${dataModel.stats.inferred} exist only as a bare id column. ${dataModel.stats.crossContext} of them cross a bounded context.`,
      items: relations.filter((r) => !r.declared).map((r) => `${r.from}.${r.via} -> ${r.to}${r.cross ? '  (crosses ' + r.fromModule + ' -> ' + r.toModule + ')' : ''}`),
    });
  }

  // fan-in per file, shared by the hotspots ranking and the test crossing below
  const fanIn = {};
  for (const l of fileLinks) fanIn[l[1]] = (fanIn[l[1]] || 0) + 1;

  if (churnMeta.available) {
    const scored = fileNodes.map((n, i) => {
      const c = churn[n.f];
      if (!c) return null;
      const deps = fanIn[i] || 0;
      // both factors matter, so multiply rather than add; +1 keeps a leaf scoreable
      return { f: n.f, p: n.p, commits: c.commits, deps, authors: c.authorCount,
               score: c.commits * (1 + deps) };
    }).filter(Boolean)
      .filter((x) => !['spec', 'test-util', 'migration'].includes(x.p))
      .sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 15);
    if (top.length) {
      findings.push({
        id: 'hotspots', tone: 'note',
        title: 'Files that change often and are widely depended on',
        detail: `Across ${churnMeta.commits} commits. Score is commits multiplied by dependents: a file high on both is where a refactor pays for itself, and where a mistake spreads furthest.`,
        items: top.map((x) => `${x.f}  —  ${x.commits} commits, ${x.deps} dependents, ${x.authors} author${x.authors === 1 ? '' : 's'}`),
      });
    }
  }

  // ---- test presence crossed with risk (spec 06)
  //
  // The forward pass attributes each source file to a test. It cannot tell
  // whether the locator fits this project, so the reverse pass asks the
  // question that can: every spec must be claimed by exactly one source. When
  // too many specs are unmatched the locator is misconfigured and the test
  // findings suppress themselves — a confident wrong coverage report is worse
  // than none.
  const locators = cfg.testLocators || [];
  const specSet = new Set(files.filter((f) => info[f].pattern === 'spec'));
  const testClaims = {};
  const strategyHits = {};
  const bySource = {};
  for (const f of files) {
    if (specSet.has(f)) continue;
    let hit = null;
    for (let i = 0; i < locators.length; i++) {
      let cand;
      try { cand = locators[i](f); } catch { continue; }
      if (typeof cand !== 'string' || !specSet.has(cand)) continue;
      hit = cand;
      strategyHits[i] = (strategyHits[i] || 0) + 1;
      break;
    }
    bySource[f] = hit;
    if (hit) testClaims[hit] = (testClaims[hit] || 0) + 1;
  }
  const unmatchedSpecs = [...specSet].filter((s) => testClaims[s] !== 1).sort();
  const specFiles = specSet.size;
  const reliable = specFiles === 0 || unmatchedSpecs.length / specFiles <= 0.25;
  const byPattern = {};
  for (const f of files) {
    const p = info[f].pattern;
    if (SKIP_PAT.has(p)) continue;
    const e = byPattern[p] || (byPattern[p] = { total: 0, tested: 0 });
    e.total++;
    if (bySource[f]) e.tested++;
  }
  const dominant = Object.keys(strategyHits).sort((a, b) =>
    strategyHits[b] - strategyHits[a] || Number(a) - Number(b))[0];
  const tests = {
    bySource, unmatchedSpecs, byPattern,
    meta: { specFiles, matched: specFiles - unmatchedSpecs.length,
            strategy: dominant !== undefined ? 'index ' + dominant : 'none', reliable },
  };

  if (tests.meta.reliable) {
    if (Object.keys(byPattern).length) {
      const rows = Object.entries(byPattern)
        .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
      findings.push({
        id: 'test-ratio', tone: 'note',
        title: 'Test presence by pattern',
        detail: `Tested / total source files, pattern by pattern. This is presence, not quality — a file with one smoke test counts as tested.` +
          (unmatchedSpecs.length
            ? ` ${unmatchedSpecs.length} of ${specFiles} spec files matched no source by name and count as testing nothing.`
            : ''),
        items: rows.map(([p, e]) => `${p} ${e.tested}/${e.total}`),
      });
    }
    if (churnMeta.available) {
      const untested = fileNodes.map((n, i) => {
        if (SKIP_PAT.has(n.p) || bySource[n.f]) return null;
        const c = churn[n.f];
        if (!c) return null;
        const deps = fanIn[i] || 0;
        return { f: n.f, commits: c.commits, deps, score: c.commits * (1 + deps) };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      const top = untested.slice(0, 15);
      if (top.length) {
        findings.push({
          id: 'untested-risk', tone: 'warn',
          title: `${top.length} high-risk file${top.length === 1 ? '' : 's'} ${top.length === 1 ? 'has' : 'have'} no test`,
          detail: `Ranked by commits multiplied by dependents — the same score the hotspots lens uses. A file that changes often, is widely depended on, and is unverified is where a regression is both most likely and most costly.`,
          items: top.map((x) => `${x.f} — ${x.commits} commits, ${x.deps} dependents, no test`),
        });
      }
    }
  }

  if (cycles.files.length) {
    findings.push({
      id: 'circular', tone: 'warn', title: 'Circular imports between files',
      detail: 'Mutually importing files — genuine runtime cycles.',
      items: cycles.files.map((c) => c.join('  <->  ')),
      instances: cycles.files.map((c) => ({ from: c[0], to: c.slice(1).join(',') })),
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

  const model = {
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
    fileNodes, fileLinks, dataModel, orphans, churn, churnMeta, diagnostics, bindings, tests,
  };
  // Derived, so it costs nothing extra and travels with a cached model.
  model.violations = violationsOf(model);
  return model;
};

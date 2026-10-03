'use strict';
/**
 * The wiring model for a React frontend (spec 12): the backend's shape —
 * bricks, sockets, studs, wires, calls, grip — read off components, hooks,
 * contexts and the request layer.
 *
 *   brick    a component, a hook, a context, a file of functions, a class,
 *            or a script (main.tsx)
 *   socket   a hook a component or hook calls, or a context it reads
 *   stud     a component's render (its props), a hook, a context's value,
 *            an exported function
 *   call     render (<Child/>), hook (useX()), context (useContext(X)),
 *            call (a function, called or passed), http (the API client)
 *
 * Nothing is invented: a render is a tag naming a component the file imports
 * or declares, a hook is a use*( call, an HTTP call is the client's method.
 * Package components and hooks (MUI, react-router, react-query) are the
 * framework, counted but not edges.
 */

const { splitTop } = require('./shapes');

const HTTP_VERBS = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete)\s*(?:<([^>()]*(?:<[^>()]*>[^>()]*)*)>)?\s*\(/g;

/** Every import in a file: local name -> { spec, name (as exported), type }. */
function importsOf(src) {
  const out = {};
  const re = /(?:^|\n)\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const typeOnly = !!m[1];
    let clause = m[2].trim();
    const spec = m[3];
    const ns = clause.match(/\*\s+as\s+([\w$]+)/);
    if (ns) { out[ns[1]] = { spec, name: '*', type: typeOnly }; continue; }
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      for (const raw of named[1].split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const isType = typeOnly || /^type\s/.test(t);
        const parts = t.replace(/^type\s+/, '').split(/\s+as\s+/);
        const local = parts.pop().trim();
        out[local] = { spec, name: (parts[0] || local).trim(), type: isType };
      }
      clause = clause.replace(/\{[\s\S]*\}/, '').replace(/,\s*$/, '').trim();
    }
    const def = clause.replace(/,$/, '').trim();
    if (def) out[def] = { spec, name: 'default', type: typeOnly };
  }
  return out;
}

function reactWiringOf(ctx) {
  const { files, text, info, decl, tiers, diagnostics, resolveSpec } = ctx;
  const testTier = tiers.findIndex((t) => t.name === 'Test');
  const tierNamed = (name, fallback) => { const i = tiers.findIndex((t) => t.name === name); return i < 0 ? fallback : i; };
  const T = { page: tierNamed('Page'), component: tierNamed('Component'), hook: tierNamed('Hook'), state: tierNamed('State') };

  // 1-based lines per file
  const lineAt = {};
  for (const rel of files) {
    const starts = [0];
    const src = text[rel];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
    lineAt[rel] = (idx) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
      return lo + 1;
    };
  }

  // ---- what is code: a name in a comment, a string, JSX text or an import
  // statement is not a use of it
  const importSpans = {};
  for (const rel of files) {
    const spans = [];
    const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?\bfrom\s*['"][^'"]+['"]/g;
    let m;
    while ((m = re.exec(text[rel]))) spans.push([m.index, m.index + m[0].length]);
    importSpans[rel] = spans;
  }
  const inSpans = (spans, idx) => {
    let lo = 0, hi = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (idx < spans[mid][0]) hi = mid - 1; else if (idx >= spans[mid][1]) lo = mid + 1; else return true;
    }
    return false;
  };
  const isCode = (rel, idx) => !inSpans(decl[rel].nonCode || [], idx) && !inSpans(importSpans[rel], idx);

  // ---- imports, resolved
  const imports = {};
  for (const rel of files) {
    const raw = importsOf(text[rel]);
    for (const [local, im] of Object.entries(raw)) {
      const file = resolveSpec(im.spec, rel);
      im.file = file || null;
      im.missing = file === undefined;        // local, but names no file (import-unresolved)
      im.pkg = file === null ? im.spec : null;
      raw[local] = im;
    }
    imports[rel] = raw;
  }

  // ---- bricks
  const bricks = [];
  const byId = new Map();
  const add = (b) => { bricks.push(b); byId.set(b.id, b); return b; };
  const defaultExport = {};                     // file -> local name it default-exports
  const contextsIn = {};                        // file -> [names]
  for (const rel of files) {
    const fi = info[rel];
    const src = text[rel];
    const dm = src.match(/(?:^|\n)\s*export\s+default\s+(?:function\s+|class\s+)?([A-Za-z_$][\w$]*)/);
    if (dm && dm[1] !== 'function' && dm[1] !== 'class') defaultExport[rel] = dm[1];
    if (fi.tier === testTier) continue;
    const d = decl[rel];
    const base = { file: rel, module: fi.module, pattern: fi.pattern, decorators: [], extends: null };
    const tsx = rel.endsWith('.tsx');
    const fns = [];
    for (const f of d.functions) {
      const isHook = /^use[A-Z]/.test(f.name);
      const isComp = !isHook && tsx && /^[A-Z]/.test(f.name);
      if (isComp) {
        const tier = fi.pattern === 'page' ? T.page : (fi.tier <= T.component ? fi.tier : T.component);
        add(Object.assign({ id: rel + '#' + f.name, name: f.name, shape: 'component', tier, lines: [f.start, f.end],
          fn: f }, base, f.wrapped ? { wrapped: f.wrapped } : {}));
      } else if (isHook) {
        add(Object.assign({ id: rel + '#' + f.name, name: f.name, shape: 'hook', tier: T.hook, lines: [f.start, f.end], fn: f }, base));
      } else {
        fns.push(f);
      }
    }
    const ctxRe = /(?:^|\n)(\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:React\s*\.\s*)?createContext\b)/g;
    let cm;
    while ((cm = ctxRe.exec(src))) {
      const line = lineAt[rel](cm.index + cm[0].indexOf(cm[1]) + 1);
      (contextsIn[rel] = contextsIn[rel] || []).push(cm[2]);
      add(Object.assign({ id: rel + '#' + cm[2], name: cm[2], shape: 'context', tier: T.state, lines: [line, line] }, base));
    }
    for (const c of d.classes) {
      add(Object.assign({ id: rel + '#' + c.name, name: c.name, shape: 'class', tier: fi.tier, lines: [c.start, c.end], cls: c }, base));
    }
    // Any other top-level function gets a brick, exported or not: a helper
    // beside a hook is where that hook's HTTP call may live. It is named for
    // its file; by the file's full name when a component, hook or context in
    // the same file already has the short one (TagActionPanel.tsx beside
    // TagActionPanel), so a list never shows two of one name.
    const stem = rel.split('/').pop().replace(/\.tsx?$/, '');
    if (fns.length && fi.pattern !== 'bootstrap') {
      const taken = bricks.some((b) => b.file === rel && b.name === stem);
      add(Object.assign({ id: rel, name: taken ? rel.split('/').pop() : stem, shape: 'functions', tier: fi.tier,
        lines: [1, fi.loc], fns }, base));
    } else if (fi.pattern === 'bootstrap') {
      add(Object.assign({ id: rel, name: rel.split('/').pop().replace(/\.tsx?$/, ''), shape: 'script', tier: fi.tier,
        lines: [1, fi.loc], fns }, base));
    }
  }

  /** What a name used in `rel` refers to: a brick id, a package, or nothing. */
  function refOf(rel, name) {
    const local = [rel + '#' + name].find((id) => byId.has(id));
    if (local) return { brick: local };
    const im = imports[rel][name];
    if (!im) return null;
    if (im.pkg) return { pkg: im.pkg };
    if (im.missing) return { missing: true };
    if (!im.file) return null;
    const exported = im.name === 'default' ? defaultExport[im.file] || name : im.name;
    if (byId.has(im.file + '#' + exported)) return { brick: im.file + '#' + exported };
    const fb = byId.get(im.file);
    if (fb && fb.shape === 'functions' && fb.fns.some((f) => f.name === exported && f.exported)) return { fnBrick: im.file, fn: exported };
    return { file: im.file, name: exported };
  }

  // ---- sockets and studs
  const wires = [];
  const calls = [];
  const meta = { sockets: 0, resolved: 0, framework: 0, unresolved: 0 };
  const bodyOf = (rel, f) => text[rel].slice(f.bodyOpen, f.bodyClose + 1);

  for (const b of bricks) {
    b.sockets = [];
    b.studs = [];
    b.internals = [];
    const src = text[b.file];
    if (b.shape === 'component' || b.shape === 'hook') {
      const f = b.fn;
      const body = bodyOf(b.file, f);
      const seen = new Set();
      const socket = (s) => {
        b.sockets.push(s);
        meta.sockets++;
        meta[s.status === 'unresolved' ? 'unresolved' : s.status === 'framework' ? 'framework' : 'resolved']++;
        if (s.to) {
          wires.push({ from: b.id, to: s.to, prop: s.prop, via: s.via });
          calls.push({ from: b.id, fromMethod: b.name, to: s.to, toMethod: s.via === 'context' ? 'value' : s.prop,
            line: s.line, kind: s.via });
        }
      };
      const hre = /(?:\b(React)\s*\.\s*)?\b(use[A-Z][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g;
      let m;
      while ((m = hre.exec(body))) {
        const name = m[2];
        const at = f.bodyOpen + m.index;
        if (!isCode(b.file, at)) continue;
        if (name === b.name) continue;                        // recursion, not a socket
        if (name === 'useContext') {
          const arg = body.slice(m.index + m[0].length).match(/^\s*([A-Za-z_$][\w$]*)/);
          if (!arg) continue;
          const key = 'context:' + arg[1];
          if (seen.has(key)) continue;
          seen.add(key);
          const r = refOf(b.file, arg[1]);
          const to = r && r.brick && byId.get(r.brick).shape === 'context' ? r.brick : null;
          socket(to ? { prop: arg[1], type: 'context', line: lineAt[b.file](at), status: 'resolved', to, via: 'context' }
            : { prop: arg[1], type: 'context', line: lineAt[b.file](at), status: r && r.pkg ? 'framework' : 'unresolved',
              to: null, via: 'context', from: r && r.pkg ? r.pkg : undefined, reason: r && r.pkg ? undefined : 'not-a-context' });
          continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        const line = lineAt[b.file](at);
        if (m[1]) { socket({ prop: name, type: 'hook', line, status: 'framework', to: null, via: 'hook', from: 'react' }); continue; }
        const r = refOf(b.file, name);
        if (r && r.brick && byId.get(r.brick).shape === 'hook') socket({ prop: name, type: 'hook', line, status: 'resolved', to: r.brick, via: 'hook' });
        else if (r && r.pkg) socket({ prop: name, type: 'hook', line, status: 'framework', to: null, via: 'hook', from: r.pkg });
        else {
          const reason = r && r.missing ? 'import-unresolved' : r ? 'not-a-hook' : 'not-found';
          socket({ prop: name, type: 'hook', line, status: 'unresolved', to: null, via: 'hook', reason });
          // An import that names no file is already its own diagnostic.
          if (reason !== 'import-unresolved') {
            diagnostics.push({ kind: 'socket-unresolved', file: b.file, line,
              detail: `${name}() — ${reason === 'not-a-hook' ? 'imported, but not a hook in the scanned tree' : 'not imported and not declared in this file'}` });
          }
        }
      }
      if (b.shape === 'component') {
        const p = propsOf(src, f);
        b.studs.push({ name: 'render', sig: `<${b.name}${p.names.length ? ' ' + p.names.join(' ') : ''} />`,
          props: p.names, propsType: p.type, lines: [f.start, f.end], async: false, kind: 'render', static: false,
          decorators: [], route: null });
      } else {
        b.studs.push({ name: b.name, sig: f.sig, lines: [f.start, f.end], async: !!f.async, kind: 'hook', static: false,
          decorators: [], route: null });
      }
    } else if (b.shape === 'context') {
      b.studs.push({ name: 'value', sig: `${b.name}.Provider value`, lines: b.lines, async: false, kind: 'context',
        static: false, decorators: [], route: null });
    } else if (b.shape === 'functions' || b.shape === 'script') {
      for (const f of b.fns) {
        const s = { name: f.name, sig: f.sig, lines: [f.start, f.end], async: !!f.async, kind: 'function', static: false,
          decorators: [], route: null };
        if (f.exported && b.shape === 'functions') b.studs.push(s); else b.internals.push(s);
      }
    } else if (b.shape === 'class') {
      for (const m of b.cls.members) {
        if (m.kind === 'constructor' || m.kind === 'get' || m.kind === 'set') continue;
        const s = { name: m.name, sig: m.sig, lines: [m.start, m.end], async: !!m.async, kind: 'method', static: !!m.static,
          decorators: m.decorators || [], route: null };
        if (m.access === 'public') b.studs.push(s); else { s.access = m.access; b.internals.push(s); }
      }
    }
  }

  // ---- bodies: every place code runs, and which brick it belongs to
  const bodies = [];
  for (const b of bricks) {
    if (b.shape === 'component' || b.shape === 'hook') bodies.push({ b, method: b.name, from: b.fn.bodyOpen, to: b.fn.bodyClose + 1 });
    else if (b.shape === 'functions' || b.shape === 'script') {
      for (const f of b.fns) bodies.push({ b, method: f.name, from: f.bodyOpen, to: f.bodyClose + 1 });
      if (b.shape === 'script') bodies.push({ b, method: null, from: 0, to: text[b.file].length, topLevel: true });
    } else if (b.shape === 'class') {
      for (const m of b.cls.members) if (m.bodyOpen >= 0) bodies.push({ b, method: m.name, from: m.bodyOpen, to: m.bodyClose + 1 });
    }
  }
  // The innermost body owns an offset (a helper declared inside a component
  // body belongs to the component, not to the file).
  const ownerOf = (rel, idx) => {
    let best = null;
    for (const x of bodies) {
      if (x.b.file !== rel || idx < x.from || idx >= x.to) continue;
      if (!best || (x.to - x.from) < (best.to - best.from)) best = x;
    }
    return best;
  };

  // ---- renders: <Name …> for a component the file imports or declares
  const frameworkRenders = {};
  const renderRe = /<([A-Z][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?(?=[\s/>])/g;
  for (const rel of files) {
    if (!rel.endsWith('.tsx') || info[rel].tier === testTier) continue;
    const src = text[rel];
    let m;
    renderRe.lastIndex = 0;
    while ((m = renderRe.exec(src))) {
      const prev = src[m.index - 1] || '';
      if (/[\w$)\]]/.test(prev)) continue;                // a type argument: useState<Thing>(
      if (!isCode(rel, m.index)) continue;
      if (/^\s*,/.test(src.slice(m.index + m[0].length))) continue;   // <T,> generic
      const own = ownerOf(rel, m.index);
      if (!own) continue;
      const r = refOf(rel, m[1]);
      if (!r) continue;
      if (r.pkg) { frameworkRenders[own.b.id] = (frameworkRenders[own.b.id] || 0) + 1; continue; }
      const target = r.brick && byId.get(r.brick);
      if (!target) continue;
      if (target.shape === 'component' && !m[2]) {
        if (target.id === own.b.id) continue;
        // <Route element={<Page/>}> mounts the page: the route grips it, not the router.
        const mount = /\belement\s*=\s*\{\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index));
        calls.push({ from: own.b.id, fromMethod: own.method, to: target.id, toMethod: 'render', line: lineAt[rel](m.index),
          kind: mount ? 'mount' : 'render' });
      } else if (target.shape === 'context' && m[2] === 'Provider') {
        calls.push({ from: own.b.id, fromMethod: own.method, to: target.id, toMethod: 'value', line: lineAt[rel](m.index), kind: 'provide' });
      }
    }
  }

  // ---- components passed as values (slots={{ item: TreeItem }}, component={X}):
  // used, though never written as a tag
  for (const rel of files) {
    if (info[rel].tier === testTier) continue;
    const src = text[rel];
    const names = new Set(Object.keys(imports[rel]).concat(
      bricks.filter((b) => b.file === rel && b.shape === 'component').map((b) => b.name)));
    for (const local of names) {
      if (!/^[A-Z]/.test(local)) continue;
      const r = refOf(rel, local);
      const target = r && r.brick && byId.get(r.brick);
      if (!target || target.shape !== 'component') continue;
      const re = new RegExp('(^|[^\\w$.<])' + local.replace(/\$/g, '\\$') + '\\b(?![\\w$]|\\s*[:=(]|\\s*\\.)', 'g');
      let m;
      while ((m = re.exec(src))) {
        const idx = m.index + m[1].length;
        if (src[idx - 1] === '/' && src[idx - 2] === '<') continue;       // </Name>
        if (!isCode(rel, idx)) continue;
        const own = ownerOf(rel, idx);
        if (!own || own.b.id === target.id) continue;
        if (/^\s*[:=]/.test(src.slice(idx + local.length))) continue;
        calls.push({ from: own.b.id, fromMethod: own.method, to: target.id, toMethod: 'render', line: lineAt[rel](idx), kind: 'render', ref: true });
      }
    }
  }

  // ---- calls into function bricks: called, or passed (queryFn: fetchThings)
  for (const rel of files) {
    if (info[rel].tier === testTier) continue;
    const src = text[rel];
    for (const [local, im] of Object.entries(imports[rel])) {
      if (im.type || !im.file) continue;
      const r = refOf(rel, local);
      if (!r || !r.fnBrick) continue;
      const re = new RegExp('(^|[^\\w$.])' + local.replace(/\$/g, '\\$') + '\\b(?!\\s*:)', 'g');
      let m;
      while ((m = re.exec(src))) {
        const idx = m.index + m[1].length;
        if (!isCode(rel, idx)) continue;
        const own = ownerOf(rel, idx);
        if (!own || own.b.id === r.fnBrick) continue;
        const called = /^\s*(?:<[^>()]*>)?\s*\(/.test(src.slice(idx + local.length));
        const c = { from: own.b.id, fromMethod: own.method, to: r.fnBrick, toMethod: r.fn, line: lineAt[rel](idx), kind: 'call' };
        if (!called) c.ref = true;
        calls.push(c);
      }
    }
  }

  // ---- HTTP: the client's get/post/put/patch/delete, where the client is
  // an axios instance the tree creates (or axios itself)
  const clientFiles = new Set(files.filter((f) => /\baxios\s*\.\s*create\s*\(/.test(text[f])));
  const http = { calls: 0, unread: 0 };
  /** One HTTP call: on the call list, on its stud, and a diagnostic if unread. */
  const record = (x, rel, idx, verb, path, what, declared = {}) => {
    const line = lineAt[rel](idx);
    http.calls++;
    if (path === null || verb === null) {
      http.unread++;
      diagnostics.push({ kind: 'http-unread', file: rel, line,
        detail: `${what} — the ${path === null ? 'URL' : 'method'} is not a literal or a template metatron reads` });
    }
    calls.push(Object.assign({ from: x.b.id, fromMethod: x.method, to: null, toMethod: null, line, kind: 'http', verb, path }, declared));
    const stud = x.b.studs.find((s) => s.name === x.method) || x.b.internals.find((s) => s.name === x.method)
      || (x.b.shape === 'component' ? x.b.studs[0] : null);
    if (stud) (stud.http = stud.http || []).push({ verb, path, line });
  };
  for (const x of bodies) {
    if (x.topLevel) continue;
    const rel = x.b.file;
    const src = text[rel];
    const seg = src.slice(x.from, x.to);
    HTTP_VERBS.lastIndex = 0;
    let m;
    while ((m = HTTP_VERBS.exec(seg))) {
      const idx = x.from + m.index;
      if (!isCode(rel, idx)) continue;
      if (ownerOf(rel, idx) !== x) continue;               // counted in the inner body
      const client = m[1];
      const im = imports[rel][client];
      const isClient = client === 'axios' ? !!(im && im.pkg === 'axios')
        : !!(im && im.file && clientFiles.has(im.file)) || (clientFiles.has(rel) && /\baxios\s*\.\s*create/.test(src));
      if (!isClient) continue;
      // Spec 15: what the call declares — the body it sends, the type it expects
      const args = argsOf(seg, m.index + m[0].length);
      const sends = /^(post|put|patch)$/.test(m[2]);
      record(x, rel, idx, m[2].toUpperCase(), urlOf(seg, m.index + m[0].length), `${client}.${m[2]}(…)`, {
        body: sends ? sentOf(args[1], seg, x) : { kind: 'none' },
        expects: m[3] ? m[3].trim() : null,
      });
    }
    // fetch(url, { method }) — the platform's own client. The method is read
    // from the options; none means GET, a variable means unread.
    const FETCH = /(?:^|[^\w$.]|\bwindow\s*\.\s*)fetch\s*\(/g;
    while ((m = FETCH.exec(seg))) {
      const open = m.index + m[0].length;
      const idx = x.from + open - 1;
      if (!isCode(rel, idx)) continue;
      if (ownerOf(rel, idx) !== x) continue;
      if (imports[rel].fetch) continue;                    // a fetch the file imports is not the platform's
      const init = argsOf(seg, open)[1] || '';
      const sent = init.match(/\bbody\s*:\s*JSON\s*\.\s*stringify\s*\(([\s\S]*)\)\s*,?\s*\}?\s*$/) || init.match(/\bbody\s*:\s*JSON\s*\.\s*stringify\s*\(([^()]*)\)/);
      record(x, rel, idx, fetchVerb(seg, open), urlOf(seg, open), 'fetch(…)', {
        body: sent ? sentOf(sent[1], seg, x) : { kind: 'none' }, expects: null,
      });
    }
  }

  // A call with no generic expects what its function declares it returns,
  // when that function makes this one call and no other. A plain function
  // or method only: a hook's or component's return is not the response.
  const perFn = new Map();
  for (const c of calls) if (c.kind === 'http') { const k = c.from + '#' + c.fromMethod; perFn.set(k, (perFn.get(k) || 0) + 1); }
  for (const c of calls) {
    if (c.kind !== 'http') continue;
    if (c.expects) { c.expectsFrom = 'generic'; continue; }
    if (perFn.get(c.from + '#' + c.fromMethod) !== 1) continue;
    const b = byId.get(c.from);
    const stud = b && b.studs.concat(b.internals).find((x) => x.name === c.fromMethod);
    const ret = stud && (stud.kind === 'function' || stud.kind === 'method') && returnTypeOf(stud.sig);
    if (ret) { c.expects = ret; c.expectsFrom = 'return'; }
  }

  // ---- routes
  const routes = routesOf(ctx, { files, text, imports, refOf, lineAt, diagnostics, byId });

  // ---- grip
  const gripped = new Set();
  for (const c of calls) if (c.to && c.kind !== 'mount') gripped.add(c.to + '\u0000' + c.toMethod);
  const routed = new Map();
  for (const r of routes) if (r.component) (routed.get(r.component) || routed.set(r.component, []).get(r.component)).push(r.path);
  const studs = { total: 0, brick: 0, route: 0, framework: 0, unseen: 0 };
  for (const b of bricks) {
    if (routed.has(b.id) && b.studs[0]) b.studs[0].route = routed.get(b.id).filter(Boolean).join(', ') || '(computed path)';
    for (const s of b.studs) {
      s.grip = gripped.has(b.id + '\u0000' + s.name) ? 'brick' : s.route ? 'route' : 'unseen';
      studs.total++;
      studs[s.grip]++;
    }
    if (frameworkRenders[b.id]) b.frameworkRenders = frameworkRenders[b.id];
    delete b.fn; delete b.fns; delete b.cls;
  }

  const key = (c) => [c.from, c.line, c.kind, c.to, c.toMethod].join('\u0000');
  calls.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  bricks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wiringMeta = {
    sockets: meta.sockets, resolved: meta.resolved + meta.framework, port: 0, framework: meta.framework,
    unresolved: meta.unresolved, studs, http,
    renders: calls.filter((c) => c.kind === 'render').length,
    frameworkRenders: Object.values(frameworkRenders).reduce((a, n) => a + n, 0),
  };
  return { bricks, wires, calls, wiringMeta, routes };
}

/** A component's props: destructured names, and the type it declares. */
function propsOf(src, f) {
  const params = f.pOpen >= 0 ? src.slice(f.pOpen + 1, f.pClose) : '';
  const names = [];
  const destr = params.match(/^\s*\{([\s\S]*?)\}\s*(?::\s*([\s\S]+))?$/);
  if (destr) {
    for (const raw of destr[1].split(',')) {
      const n = raw.trim().replace(/^\.\.\./, '...').split(/[=:]/)[0].trim();
      if (n) names.push(n);
    }
  }
  let type = destr && destr[2] ? destr[2].trim() : null;
  if (!type) {
    const t = params.match(/:\s*([\s\S]+)$/);
    if (t) type = t[1].trim();
  }
  if (!type) {
    // const X: React.FC<Props> = (…) =>
    const decl = src.slice(Math.max(0, src.lastIndexOf('\n', f.pOpen - 1)), f.pOpen);
    const fc = decl.match(/:\s*(?:React\s*\.\s*)?(?:FC|FunctionComponent)\s*<([^>]+)>/);
    if (fc) type = fc[1].trim();
  }
  return { names, type: type ? type.replace(/\s+/g, ' ') : null };
}

/** A call's top-level arguments, from just past its `(`. */
function argsOf(seg, i) {
  const out = [];
  let d = 0, cur = '', q = null;
  for (let j = i; j < seg.length; j++) {
    const ch = seg[j];
    if (q) { cur += ch; if (ch === q && seg[j - 1] !== '\\') q = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { if (d === 0) break; d--; }
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * What a request sends, as written: an object literal's keys (a spread makes
 * it open), or a name with the type its declaration gives it (the enclosing
 * function's parameter, or a local `const x: T`).
 */
function sentOf(arg, seg, x) {
  if (!arg) return { kind: 'none' };
  const a = arg.trim();
  if (a.startsWith('{')) {
    const keys = [];
    let open = false;
    for (const part of splitTop(a.slice(1, a.lastIndexOf('}')), ',\n')) {
      if (part.startsWith('...')) { open = true; continue; }
      const k = part.match(/^['"]?([A-Za-z_$][\w$]*)['"]?/);
      if (k) keys.push(k[1]);
    }
    return { kind: 'literal', keys, open };
  }
  const name = (a.match(/^([A-Za-z_$][\w$]*)$/) || [])[1];
  if (!name) return { kind: 'other', text: a.slice(0, 80) };
  return { kind: 'name', name, type: declaredType(name, seg, x) };
}

/** A function signature's declared return type: `name(…): T` gives T. */
function returnTypeOf(sig) {
  if (!sig || sig[0] === '<') return null;
  const open = sig.indexOf('(');
  if (open < 0) return null;
  let d = 0, j = open;
  for (; j < sig.length; j++) {
    if (sig[j] === '(') d++;
    else if (sig[j] === ')') { d--; if (d === 0) break; }
  }
  const rest = sig.slice(j + 1).match(/^\s*:\s*([\s\S]+)$/);
  return rest ? rest[1].trim() : null;
}

/** The type a name is declared with: a local `const name: T`, or the enclosing function's parameter. */
function declaredType(name, seg, x) {
  const local = seg.match(new RegExp('\\b(?:const|let)\\s+' + name + '\\s*:\\s*([^=;]+?)\\s*='));
  if (local) return local[1].trim();
  const stud = x.b.studs.concat(x.b.internals).find((s) => s.name === x.method);
  const sig = stud && stud.sig;
  if (!sig || sig[0] === '<') return null;           // a component's stud is its render, not a signature
  const open = sig.indexOf('(');
  const params = argsOf(sig, open + 1);
  for (const p of params) {
    const m = p.match(new RegExp('^(?:\\.\\.\\.)?' + name + '\\??\\s*:\\s*([\\s\\S]+?)(\\s*=[\\s\\S]*)?$'));
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * The method of a `fetch(url, init)` call whose arguments start at `i`: the
 * `method` of the init object when it is a string literal, GET when there is
 * none, null when it is anything else (a variable).
 */
function fetchVerb(seg, i) {
  let depth = 1, j = i;
  for (; j < seg.length && depth; j++) {
    if ('([{'.includes(seg[j])) depth++;
    else if (')]}'.includes(seg[j])) depth--;
  }
  const args = seg.slice(i, j - 1);
  const lit = args.match(/\bmethod\s*:\s*(['"`])([A-Za-z]+)\1/);
  if (lit) return lit[2].toUpperCase();
  return /\bmethod\b/.test(args) ? null : 'GET';
}

/**
 * The URL argument at `i` (just past the call's paren): a string literal, a
 * template, or a local const holding one. Null when it is anything else.
 */
function urlOf(seg, i) {
  const rest = seg.slice(i).replace(/^\s+/, '');
  const lit = rest.match(/^(['"`])((?:(?!\1)[^\\]|\\.)*)\1/);
  if (lit) return lit[2];
  const id = rest.match(/^([A-Za-z_$][\w$]*)\s*[,)]/);
  if (id) {
    const def = seg.match(new RegExp('\\bconst\\s+' + id[1] + '\\s*(?::[^=]+)?=\\s*([\'"`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1'));
    if (def) return def[2];
  }
  return null;
}

/**
 * The <Route> tree of every file that renders one: path (literal, or a member
 * of a constant object in the tree), element (<Page/>), nesting joined.
 */
function routesOf(ctx, { files, text, imports, refOf, lineAt, diagnostics }) {
  const routes = [];
  const constValue = (rel, obj, key) => {
    const im = imports[rel][obj];
    const file = im && im.file ? im.file : rel;
    const name = im && im.file ? (im.name === 'default' ? obj : im.name) : obj;
    const src = text[file];
    if (!src) return undefined;
    const at = src.search(new RegExp('\\bconst\\s+' + name + '\\s*(?::[^=]+)?=\\s*\\{'));
    if (at < 0) return undefined;
    const body = src.slice(at, at + 4000);
    const kv = body.match(new RegExp('\\b' + key + '\\s*:\\s*([\'"`])([^\'"`]*)\\1\\s*[,}\\n]'));
    return kv && !kv[2].includes('${') ? kv[2] : null;
  };
  const join = (parent, p) => {
    if (p === null || parent === null) return null;
    if (p.startsWith('/')) return p;
    return ((parent || '').replace(/\/$/, '') + '/' + p).replace(/\/+/g, '/');
  };
  for (const rel of files) {
    const src = text[rel];
    if (!/<Route[\s/>]/.test(src)) continue;
    const re = /<(\/?)Route(?=[\s/>])((?:[^<>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)(\/?)>/g;
    const stack = [];
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) { stack.pop(); continue; }
      const attrs = m[2];
      const selfClosing = m[3] === '/';
      const line = lineAt[rel](m.index);
      let p;
      const lit = attrs.match(/\bpath\s*=\s*(['"])([^'"]*)\1/);
      const expr = attrs.match(/\bpath\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\}/);
      if (lit) p = lit[2];
      else if (expr) {
        p = constValue(rel, expr[1], expr[2]);
        if (p === undefined) p = null;
        if (p === null) diagnostics.push({ kind: 'route-path-unread', file: rel, line, detail: `path={${expr[1]}.${expr[2]}} is not a string metatron can read` });
      } else if (/\bpath\s*=/.test(attrs)) {
        p = null;
        diagnostics.push({ kind: 'route-path-unread', file: rel, line, detail: 'path is computed — kept with no path' });
      } else p = '';                                     // a layout route
      const el = attrs.match(/\belement\s*=\s*\{\s*<([A-Z][\w$]*)/);
      const r = el ? refOf(rel, el[1]) : null;
      const parent = stack.length ? stack[stack.length - 1] : null;
      const full = join(parent ? parent.full : '', p);
      const route = { path: full === '' ? '/' : full, component: r && r.brick ? r.brick : null,
        element: el ? el[1] : null, parent: parent ? parent.index : null, file: rel, line };
      if (p === '') route.layout = true;             // no path: a layout route wrapping its children
      routes.push(route);
      if (!selfClosing) stack.push({ full: p === '' ? (parent ? parent.full : '') : full, index: routes.length - 1 });
    }
  }
  return routes;
}

module.exports = { reactWiringOf, importsOf, urlOf, argsOf, sentOf };

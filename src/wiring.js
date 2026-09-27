'use strict';
/**
 * The wiring model — bricks, sockets, studs (spec 09).
 *
 * A brick is the smallest unit that can be wired: a class, a file of
 * exported functions, or a port that declares a shape with no body. Its id
 * always carries its file path, because git, `diff` and `?focus=` all work in
 * files; `#Class` is what lets two classes share an address.
 */

/**
 * Bricks for every scanned file outside the Test tier. Test doubles are
 * classes too, but drawing them beside the code they stand in for would
 * double every part.
 *
 * @param ctx { files, info, decl, tiers } — `decl[rel]` is `classes.parse`
 *            output, `tiers` the model's tier list.
 */
function bricksOf(ctx) {
  const { files, info, decl, tiers } = ctx;
  const testTier = tiers.findIndex((t) => t.name === 'Test');
  const bricks = [];
  for (const rel of files) {
    const fi = info[rel];
    if (fi.tier === testTier) continue;
    const d = decl[rel];
    const base = { file: rel, module: fi.module, pattern: fi.pattern, tier: fi.tier };
    for (const c of d.classes) {
      bricks.push(Object.assign({ id: rel + '#' + c.name, name: c.name, shape: 'class' }, base, {
        lines: [c.start, c.end], decorators: c.decorators, extends: c.extends,
      }));
    }
    // A file of exported functions is one brick, whether or not it also
    // declares classes: its functions are studs no class brick would carry.
    const exported = d.functions.filter((f) => f.exported);
    if (exported.length) {
      bricks.push(Object.assign({ id: rel, name: baseName(rel), shape: 'functions' }, base, {
        lines: [1, fi.loc], decorators: [], extends: null,
      }));
    } else if (!d.classes.length && fi.pattern === 'port') {
      // A port is a hollow brick: a shape with no body. Leaving it out would
      // hide the indirection spec 05 preserves.
      bricks.push(Object.assign({ id: rel, name: baseName(rel), shape: 'port' }, base, {
        lines: [1, fi.loc], decorators: [], extends: null,
      }));
    }
  }
  return bricks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const baseName = (rel) => rel.split('/').pop().replace(/\.ts$/, '');

// Packages whose injectables Nest itself provides. A type imported from one
// of these is `framework`: known, and outside the tree by design.
const FRAMEWORK_PKG = /^(@nestjs\/|typeorm$|@mikro-orm\/|mongoose$|@prisma\/)/;

// Class decorators that make Nest construct the class and resolve its
// constructor. Without one, TypeScript emits no parameter metadata and Nest
// cannot inject a class-typed parameter: the constructor is an ordinary one,
// called with `new` (a response DTO wrapping an entity, say).
const DI_DECORATORS = new Set(['Injectable', 'Controller', 'Resolver', 'WebSocketGateway', 'Catch', 'Module']);

/**
 * Sockets on every class brick, the wires they make, and the coverage number.
 *
 * A socket is one constructor parameter. Its status says how far the scanner
 * could follow it:
 *
 *   resolved     a class in the scanned tree
 *   port         @Inject(TOKEN), bound by a module: `to` is the port,
 *                `boundTo` the class that fills it
 *   framework    provided from outside the tree, and known to be:
 *                EXTERNAL_TYPES, or a type imported from a Nest-side package
 *   unresolved   anything else, with a diagnostic saying why
 */
function wiringOf(ctx) {
  const { text, injectsOf, diagnostics, EXTERNAL_TYPES } = ctx;
  const bricks = bricksOf(ctx);
  const byId = new Map(bricks.map((b) => [b.id, b]));
  /** The brick declared as `name` in `file`, or the file's own brick. */
  const brickAt = (file, name) => {
    if (!file) return null;
    if (name && byId.has(file + '#' + name)) return file + '#' + name;
    const own = byId.get(file);
    return own && own.shape === 'port' ? own.id : null;
  };
  // Imports from outside the tree, per file: { Symbol: 'package' }.
  const pkgImport = (rel, sym) => {
    const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text[rel]))) {
      if (m[2].startsWith('.') || m[2].startsWith('src/')) continue;
      if (m[1].split(',').some((x) => x.trim().split(/\s+as\s+/).pop().trim() === sym)) return m[2];
    }
    return null;
  };
  // Port parameters the port diagnostics already explain.
  const portDiag = new Set(diagnostics
    .filter((d) => d.kind === 'port-unbound' || d.kind === 'port-ambiguous')
    .map((d) => d.file + ':' + d.line));

  const wires = [];
  const meta = { sockets: 0, resolved: 0, port: 0, framework: 0, unresolved: 0 };
  for (const b of bricks) {
    b.sockets = [];
    if (b.shape !== 'class') continue;
    const params = (injectsOf[b.file] || {})[b.name] || [];
    const di = b.decorators.some((d) => DI_DECORATORS.has(d))
      || params.some((p) => p.raw && /@Inject\w*\s*\(/.test(p.raw));
    if (!di) continue;
    for (const inj of params) {
      const s = { prop: inj.prop, type: inj.type, line: inj.line };
      const unresolved = (reason, detail) => {
        Object.assign(s, { status: 'unresolved', to: null, reason });
        if (detail) {
          diagnostics.push({ kind: 'socket-unresolved', file: b.file, line: inj.line, detail });
        }
      };
      const repoOf = inj.raw && inj.raw.match(/@Inject(?:Repository|Model)\s*\(\s*([A-Za-z_$][\w$]*)/);
      if (inj.unread) {
        unresolved('unread', `${inj.prop} — parameter is not in the \`name: Type\` form metatron reads`);
      } else if (inj.token) {
        if (inj.boundTo) {
          Object.assign(s, { status: 'port', to: brickAt(inj.file, inj.type),
            boundTo: brickAt(inj.boundTo, inj.boundCls), token: inj.token, boundIn: inj.boundIn });
        } else if (brickAt(inj.file, inj.type) && byId.get(brickAt(inj.file, inj.type)).shape === 'class') {
          // A class used as its own token is ordinary DI.
          Object.assign(s, { status: 'resolved', to: brickAt(inj.file, inj.type), token: inj.token });
        } else if (portDiag.has(b.file + ':' + inj.line)) {
          unresolved('port', null);     // already explained by the port diagnostic
        } else {
          const pkg = inj.type && pkgImport(b.file, inj.type);
          if (pkg) Object.assign(s, { status: 'framework', to: null, external: inj.type, from: pkg, token: inj.token });
          else unresolved('token', `${inj.prop}: ${inj.type} — token ${inj.token} is bound to nothing metatron can follow`);
        }
      } else if (EXTERNAL_TYPES.has(inj.type)) {
        const ext = inj.raw.match(new RegExp(':\\s*(' + inj.type + '\\s*(?:<[^,)]*>)?)'));
        Object.assign(s, { status: 'framework', to: null, external: ext ? ext[1].replace(/\s+/g, '') : inj.type });
        if (repoOf) s.entity = brickAt(ctx.symbolIndex[b.file][repoOf[1]], repoOf[1]);
      } else if (inj.file) {
        const to = brickAt(inj.file, inj.type);
        if (to) Object.assign(s, { status: 'resolved', to });
        else unresolved('not-a-class', `${inj.prop}: ${inj.type} — ${inj.file} declares no class ${inj.type}`);
      } else {
        const pkg = pkgImport(b.file, inj.type);
        if (pkg && FRAMEWORK_PKG.test(pkg)) Object.assign(s, { status: 'framework', to: null, external: inj.type, from: pkg });
        else if (pkg) unresolved('package', `${inj.prop}: ${inj.type} — imported from ${pkg}, outside the scanned tree`);
        else unresolved('not-found', `${inj.prop}: ${inj.type} — no class named ${inj.type} in the scanned tree`);
      }
      b.sockets.push(s);
      meta.sockets++;
      meta[s.status]++;
      if (s.status === 'resolved' || s.status === 'port') {
        // A port declared outside any brick (an interface in a types file)
        // still has a class that fills it: wire to that rather than nowhere.
        const w = { from: b.id, to: s.to || s.boundTo, prop: s.prop, via: s.status === 'port' ? 'port' : 'type' };
        if (s.status === 'port') w.boundTo = s.boundTo;
        if (w.to) wires.push(w);
      }
    }
  }
  studsOf(ctx, bricks);
  const calls = callsOf(ctx, bricks);
  const wiringMeta = {
    sockets: meta.sockets,
    resolved: meta.resolved + meta.port + meta.framework,
    port: meta.port, framework: meta.framework, unresolved: meta.unresolved,
  };
  return { bricks, wires, calls, wiringMeta };
}

/**
 * What each brick offers (studs) and what it keeps to itself (internals).
 *
 *   class      public methods, method or arrow-property form, static included
 *   functions  exported functions; the rest are internals
 *   port       interface method signatures, `kind: 'declared'`
 *
 * The constructor is where sockets come from, not a stud. Getters and setters
 * read as fields, and drawing one as a stud would suggest a part you plug
 * into. A route handler is a stud with `route` set: HTTP grips it.
 */
function studsOf(ctx, bricks) {
  const { decl, endpoints } = ctx;
  const routeOf = new Map((endpoints || []).map((e) => [e.file + '#' + e.cls + '#' + e.handler, e.id]));
  const shape = (m, kind) => ({
    name: m.name, sig: m.sig, lines: [m.start, m.end], async: !!m.async, kind, static: !!m.static,
  });
  for (const b of bricks) {
    b.studs = [];
    b.internals = [];
    const d = decl[b.file];
    if (b.shape === 'class') {
      const c = d.classes.find((x) => x.name === b.name);
      const seen = new Map();
      for (const m of c.members) {
        if (m.kind === 'constructor' || m.kind === 'get' || m.kind === 'set') continue;
        // An overload list is one method: keep the implementation, which has
        // the body and the full line range.
        const key = (m.static ? 'static ' : '') + m.name;
        const prev = seen.get(key);
        if (prev && !prev.abstract) continue;
        seen.set(key, m);
      }
      for (const m of seen.values()) {
        const s = shape(m, m.abstract ? 'declared' : 'method');
        if (m.access !== 'public') { s.access = m.access; b.internals.push(s); continue; }
        s.route = routeOf.get(b.file + '#' + b.name + '#' + m.name) || null;
        b.studs.push(s);
      }
    } else if (b.shape === 'functions') {
      for (const f of d.functions) {
        const s = shape(f, 'function');
        if (f.exported) { s.route = null; b.studs.push(s); } else b.internals.push(s);
      }
    } else if (b.shape === 'port') {
      for (const i of d.interfaces) {
        for (const m of i.members) {
          b.studs.push({ name: m.name, sig: m.sig, lines: [m.start, m.end], async: false,
            kind: 'declared', static: false, route: null, of: i.name });
        }
      }
    }
  }
}

/**
 * Which stud each brick grips: every call site between two bricks.
 *
 *   this.x.method(   x is a socket: the call goes where the socket goes
 *   name(            name is imported from a function brick
 *   Cls.method(      Cls is another class brick and `method` a static stud
 *
 * Unlike the trace, this reads every method of every brick, not only those
 * a route reaches. Calls inside one brick (`this.method(`) are wiring inside
 * the brick, not between bricks, and are not recorded.
 */
function callsOf(ctx, bricks) {
  const { files, text, decl } = ctx;
  const byId = new Map(bricks.map((b) => [b.id, b]));
  const calls = [];

  // Where a call site sits: the brick and method whose body contains it.
  const ranges = {};
  const lineAt = {};
  for (const rel of files) {
    const src = text[rel];
    const starts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
    lineAt[rel] = (idx) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
      return lo + 1;
    };
    const r = [];
    for (const c of decl[rel].classes) {
      if (!byId.has(rel + '#' + c.name)) continue;
      for (const m of c.members) {
        if (m.bodyOpen < 0 || m.kind === 'get' || m.kind === 'set') continue;
        r.push({ brick: rel + '#' + c.name, method: m.kind === 'constructor' ? 'constructor' : m.name,
          from: m.bodyOpen, to: m.bodyClose });
      }
    }
    if (byId.has(rel)) {
      for (const f of decl[rel].functions) r.push({ brick: rel, method: f.name, from: f.bodyOpen, to: f.bodyClose });
    }
    ranges[rel] = r;
  }
  const at = (rel, idx) => {
    let best = null;
    for (const r of ranges[rel]) {
      if (idx > r.from && idx < r.to && (!best || r.to - r.from < best.to - best.from)) best = r;
    }
    return best;
  };
  const fileBrick = (rel) => (byId.has(rel) ? rel : null);

  // Imported names, keeping the name as exported: `import { a as b }`.
  const importsOf = (rel) => {
    const out = {};
    const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text[rel]))) {
      for (const raw of m[1].split(',')) {
        const parts = raw.trim().split(/\s+as\s+/);
        const local = parts.pop().trim();
        const orig = (parts[0] || local).trim();
        const file = ctx.symbolIndex[rel][local];
        if (local && file) out[local] = { file, name: orig };
      }
    }
    return out;
  };

  for (const rel of files) {
    const src = text[rel];
    if (!ranges[rel].length && !fileBrick(rel)) continue;

    // this.x.method( through a socket
    for (const r of ranges[rel]) {
      const b = byId.get(r.brick);
      if (!b.sockets || !b.sockets.length) continue;
      const re = /this\.(\w+)\.(\w+)\s*\(/g;
      re.lastIndex = r.from;
      let m;
      while ((m = re.exec(src)) && m.index < r.to) {
        if (at(rel, m.index) !== r) continue;          // inside a nested member, counted there
        const s = b.sockets.find((x) => x.prop === m[1]);
        if (!s || !(s.status === 'resolved' || s.status === 'port')) continue;
        const c = { from: b.id, fromMethod: r.method, to: s.to || s.boundTo, toMethod: m[2], line: lineAt[rel](m.index) };
        if (s.status === 'port') c.boundTo = s.boundTo;
        calls.push(c);
      }
    }

    // name( into a function brick, Cls.method( into a static stud
    const imported = importsOf(rel);
    const targets = [];
    for (const [local, { file, name }] of Object.entries(imported)) {
      const fb = byId.get(file);
      if (fb && fb.shape === 'functions' && fb.studs.some((s) => s.name === name)) {
        targets.push({ re: new RegExp('(^|[^\\w$.])' + local + '\\s*\\(', 'g'), to: file, method: () => name });
      }
      const cb = byId.get(file + '#' + name);
      if (cb && cb.studs.some((s) => s.static)) targets.push({ re: new RegExp('(^|[^\\w$.])' + local + '\\.(\\w+)\\s*\\(', 'g'), to: cb.id, cls: cb });
    }
    // a class calling another class's static method in the same file
    for (const c of decl[rel].classes) {
      const cb = byId.get(rel + '#' + c.name);
      if (cb && cb.studs.some((s) => s.static)) targets.push({ re: new RegExp('(^|[^\\w$.])' + c.name + '\\.(\\w+)\\s*\\(', 'g'), to: cb.id, cls: cb });
    }
    for (const t of targets) {
      let m;
      while ((m = t.re.exec(src))) {
        const idx = m.index + m[1].length;
        const method = t.cls ? m[2] : t.method();
        if (t.cls && !t.cls.studs.some((s) => s.static && s.name === method)) continue;
        const r = at(rel, idx);
        const from = r ? r.brick : fileBrick(rel);
        if (!from || from === t.to) continue;           // a call inside one brick
        const c = { from, fromMethod: r ? r.method : null, to: t.to, toMethod: method, line: lineAt[rel](idx) };
        if (t.cls) c.static = true;
        calls.push(c);
      }
    }
  }
  const key = (c) => [c.from, c.line, c.to, c.toMethod].join('\u0000');
  return calls.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

module.exports = { bricksOf, wiringOf };

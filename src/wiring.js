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
  const wiringMeta = {
    sockets: meta.sockets,
    resolved: meta.resolved + meta.port + meta.framework,
    port: meta.port, framework: meta.framework, unresolved: meta.unresolved,
  };
  return { bricks, wires, wiringMeta };
}

module.exports = { bricksOf, wiringOf };

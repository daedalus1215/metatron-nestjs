'use strict';
/**
 * `metatron serve` — the workbench (spec 10).
 *
 * The first thing metatron runs that does not exit. It scans once, keeps the
 * model in memory, serves the workbench page and a small JSON API, and
 * re-scans when a file under the root changes.
 *
 * It binds 127.0.0.1 and nothing else: the page serves source code. And it
 * serves source from the scan's own text map, never from a joined path, so
 * there is nothing to traverse — and what is shown always matches the model
 * it is drawn beside.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const scan = require('./scan');
const { changeAt, modelCache } = require('./change');

const PAGE = path.resolve(__dirname, '..', 'templates', 'serve', 'workbench.html');
const HOST = '127.0.0.1';

/**
 * What the workbench reads: the wiring, and the endpoints without traces. A
 * frontend with a linked backend (spec 12) is served as one stack.
 */
function payload(model, version) {
  if (model.__backend) return joined(model, model.__backend.model, version);
  return {
    version, project: model.project, generatedAt: model.generatedAt,
    tiers: model.tiers, modules: model.modules,
    bricks: model.bricks, wires: model.wires, calls: model.calls, wiringMeta: model.wiringMeta,
    endpoints: model.endpoints.map((e) => ({ id: e.id, verb: e.verb, route: e.route, file: e.file, cls: e.cls, handler: e.handler })),
    diagnostics: model.diagnostics,
  };
}

/**
 * @param cfg   a loaded config (config.load)
 * @param opts  { watch = true, debounceMs = 300, log = console.log }
 * @returns     { server, listen(port) -> Promise<url>, rescan(), close(), state }
 */
function createWorkbench(cfg, opts = {}) {
  const log = opts.log || console.log;
  const debounceMs = opts.debounceMs === undefined ? 300 : opts.debounceMs;
  const state = { model: null, text: {}, version: 0, error: null, watching: false };
  const clients = new Set();
  // Spec 11: scans of change heads, by commit, and their text for the
  // source panel. Only a commit this server scanned can be read back.
  const cache = modelCache(8);
  const revText = new Map();

  function send(event) {
    const line = 'data: ' + JSON.stringify(event) + '\n\n';
    for (const res of clients) res.write(line);
  }

  /** Re-scan. A scan that throws keeps the last good model. */
  function rescan() {
    try {
      const model = scan(cfg);
      state.model = model;
      state.text = textOf(model);
      state.version++;
      state.error = null;
      send({ version: state.version });
    } catch (e) {
      state.error = e.message;
      send({ version: state.version, error: e.message });
      if (!state.model) throw e;
    }
    return state.version;
  }
  rescan();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + HOST);
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return json(405, { error: 'read-only' });

    if (url.pathname === '/') {
      let html;
      try { html = fs.readFileSync(PAGE, 'utf8'); } catch { return json(500, { error: 'workbench page missing' }); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (url.pathname === '/api/model') {
      return json(200, Object.assign(payload(state.model, state.version),
        { error: state.error, watching: state.watching }));
    }
    if (url.pathname === '/api/source') {
      const file = url.searchParams.get('file') || '';
      const rev = url.searchParams.get('rev');
      const text = rev ? revText.get(rev) : state.text;
      if (!text || !Object.prototype.hasOwnProperty.call(text, file)) return json(404, { error: 'not a scanned file' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(text[file]);
    }
    if (url.pathname === '/api/change') {
      const q = url.searchParams;
      const spec = q.get('pr') ? { pr: q.get('pr') } : q.get('range') ? { range: q.get('range') }
        : q.get('commits') ? { commits: q.get('commits') } : {};
      let out;
      try {
        out = changeAt(cfg, spec, { cache, current: state.model, frame: q.has('frame') ? q.get('frame') : undefined });
      } catch (e) {
        return json(400, { error: e.message });
      }
      // The head's text, and the base's: a removed brick is read at the base.
      for (const [rev, m] of [[out.change.rev, out.model], [out.change.base, out.base]]) {
        if (!rev) continue;
        revText.delete(rev);
        revText.set(rev, textOf(m));
      }
      while (revText.size > 8) revText.delete(revText.keys().next().value);
      return json(200, Object.assign(payload(out.model, state.version),
        { error: state.error, watching: state.watching, change: out.model.__backend ? prefixChange(out.change) : out.change }));
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ version: state.version, error: state.error }) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    json(404, { error: 'no such route' });
  });

  // ---- watching: one re-scan per burst of saves
  // A frontend with a linked backend watches both roots (spec 12).
  const watchers = [];
  let timer = null;
  if (opts.watch !== false) {
    const roots = [path.resolve(cfg.__dir, cfg.root)];
    const be = state.model.__backend;
    if (be) roots.push(path.resolve(be.cfg.__dir, be.cfg.root));
    try {
      for (const root of roots) {
        watchers.push(fs.watch(root, { recursive: true }, (_ev, name) => {
          if (name && !/\.tsx?$/.test(String(name))) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            const v = rescan();
            log(`  re-scanned (v${v})${state.error ? '  error: ' + state.error : ''}`);
          }, debounceMs);
        }));
      }
      state.watching = true;
    } catch (e) {
      log(`  not watching (${e.code || e.message}) — the model is static`);
    }
  }

  return {
    server, state, rescan,
    listen(port = 4477) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, () => resolve(`http://${HOST}:${server.address().port}/`));
      });
    },
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ------------------------------------------------------------ one stack
const pre = (side) => (id) => (id === null || id === undefined ? id : side + ':' + id);
const FE = pre('fe'), BE = pre('be');

function sideOf(side, m, off) {
  const p = pre(side);
  return {
    bricks: m.bricks.map((b) => Object.assign({}, b, {
      id: p(b.id), file: p(b.file), module: p(b.module), tier: b.tier + off, side,
      sockets: b.sockets.map((s) => Object.assign({}, s, { to: p(s.to), boundTo: p(s.boundTo), entity: p(s.entity) })),
    })),
    wires: m.wires.map((w) => Object.assign({}, w, { from: p(w.from), to: p(w.to), boundTo: p(w.boundTo) })),
    calls: m.calls.map((c) => Object.assign({}, c, { from: p(c.from), to: p(c.to), boundTo: p(c.boundTo) })),
    modules: m.modules.map((x) => Object.assign({}, x, { id: p(x.id) })),
    diagnostics: m.diagnostics.map((d) => Object.assign({}, d, { file: p(d.file) })),
  };
}

/**
 * The frontend over the backend: ids namespaced fe:/be:, the backend's tiers
 * stacked under the frontend's, and every matched HTTP call an edge from the
 * request function to the backend action that owns the endpoint.
 */
function joined(fe, be, version) {
  const off = fe.tiers.length;
  const f = sideOf('fe', fe, 0), b = sideOf('be', be, off);
  for (const c of f.calls) {
    if (c.kind === 'http' && c.match === 'matched') { c.to = BE(c.endpointBrick); c.toMethod = c.endpointMethod; }
  }
  const W = (k) => fe.wiringMeta[k] + be.wiringMeta[k];
  const studs = {};
  for (const k of Object.keys(be.wiringMeta.studs)) studs[k] = (fe.wiringMeta.studs[k] || 0) + be.wiringMeta.studs[k];
  return {
    version, project: fe.project, generatedAt: fe.generatedAt, sides: ['fe', 'be'],
    tiers: fe.tiers.map((t) => Object.assign({}, t, { side: 'fe' }))
      .concat(be.tiers.map((t) => Object.assign({}, t, { i: t.i + off, side: 'be' }))),
    modules: f.modules.concat(b.modules),
    bricks: f.bricks.concat(b.bricks), wires: f.wires.concat(b.wires), calls: f.calls.concat(b.calls),
    wiringMeta: { sockets: W('sockets'), resolved: W('resolved'), framework: W('framework'), unresolved: W('unresolved'),
      port: be.wiringMeta.port, studs, http: fe.wiringMeta.http },
    endpoints: be.endpoints.map((e) => ({ id: e.id, verb: e.verb, route: e.route, file: BE(e.file), cls: e.cls, handler: e.handler })),
    routes: (fe.routes || []).map((r) => Object.assign({}, r, { component: FE(r.component), file: FE(r.file) })),
    bridge: fe.bridge,
    diagnostics: f.diagnostics.concat(b.diagnostics),
  };
}

/** Source by file, for one model or both sides of a stack. */
function textOf(model) {
  if (!model.__backend) return model.__text;
  const out = {};
  for (const [k, v] of Object.entries(model.__text)) out['fe:' + k] = v;
  for (const [k, v] of Object.entries(model.__backend.model.__text)) out['be:' + k] = v;
  return out;
}

/** A frontend change, keyed like the stack it is drawn on. */
function prefixChange(change) {
  const byKey = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [FE(k), v]));
  const s = change.summary;
  return Object.assign({}, change, {
    bricks: byKey(change.bricks), studs: byKey(change.studs),
    removed: change.removed.map((r) => Object.assign({}, r, { id: FE(r.id), file: FE(r.file), module: FE(r.module) })),
    pairs: change.pairs.map((p) => Object.assign({}, p, { from: FE(p.from), to: FE(p.to) })),
    summary: Object.assign({}, s, {
      attachments: s.attachments.map((a) => ({ brick: FE(a.brick), with: a.with.map(FE), calls: a.calls })),
      grafts: s.grafts.map((a) => ({ brick: FE(a.brick), with: a.with.map(FE), calls: a.calls })),
      rewires: s.rewires.map((r) => Object.assign({}, r, { from: FE(r.from), to: FE(r.to) })),
    }),
  });
}

module.exports = { createWorkbench, payload, joined };

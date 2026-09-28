'use strict';
/**
 * Spec 10 — the workbench server. Runs against a temporary copy of the
 * wiring fixture, so the re-scan test can write to it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nestjs = require('../src/defaults/nestjs');
const { createWorkbench } = require('../src/serve');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-serve-'));
fs.cpSync(path.join(__dirname, 'fixtures', 'wiring'), path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, 'outside.ts'), 'export const SECRET = 1;\n');
fs.mkdirSync(path.join(dir, 'src', 'ignored'));
fs.writeFileSync(path.join(dir, 'src', 'ignored', 'skip.ts'), 'export const X = 1;\n');

const cfg = Object.assign({}, nestjs, {
  name: 'fixture', root: 'src', __dir: dir,
  ignore: [/\/ignored\//],
});

let wb, base;
test.before(async () => {
  wb = createWorkbench(cfg, { watch: false, log: () => {} });
  base = await wb.listen(0);
});
test.after(async () => {
  await wb.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (p) => fetch(base + p.replace(/^\//, ''));

test('binds 127.0.0.1 only', () => {
  assert.strictEqual(wb.server.address().address, '127.0.0.1');
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test('/api/model carries the wiring and slim endpoints', async () => {
  const r = await get('/api/model');
  assert.strictEqual(r.status, 200);
  const m = await r.json();
  assert.strictEqual(m.version, 1);
  assert.ok(m.bricks.some((b) => b.id === 'things/domain/services/thing.service.ts#ThingService'));
  assert.ok(m.wires.length && m.calls.length && m.wiringMeta.sockets);
  assert.deepStrictEqual(Object.keys(m.endpoints[0]).sort(), ['cls', 'file', 'handler', 'id', 'route', 'verb']);
});

test('/api/source serves a scanned file as scanned', async () => {
  const rel = 'things/domain/utils/date.utils.ts';
  const r = await get('/api/source?file=' + encodeURIComponent(rel));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await r.text(), fs.readFileSync(path.join(dir, 'src', rel), 'utf8'));
});

test('/api/source refuses anything that is not a scanned file', async () => {
  for (const file of ['../outside.ts', path.join(dir, 'outside.ts'), 'ignored/skip.ts',
    'things/../things/domain/utils/date.utils.ts', '', 'constructor', '__proto__']) {
    const r = await get('/api/source?file=' + encodeURIComponent(file));
    assert.strictEqual(r.status, 404, file);
  }
});

test('the model never carries the source text', async () => {
  const m = await (await get('/api/model')).json();
  assert.ok(!('__text' in m));
  assert.ok(!JSON.stringify(wb.state.model).includes('padStart'));
});

test('the page is served; anything but GET is refused', async () => {
  const r = await get('/');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const p = await fetch(base + 'api/model', { method: 'POST' });
  assert.strictEqual(p.status, 405);
});

test('a re-scan bumps the version and is announced; a failed one keeps the last model', async () => {
  const events = [];
  const ctrl = new AbortController();
  const stream = await fetch(base + 'api/events', { signal: ctrl.signal });
  const reader = stream.body.getReader();
  const read = async () => {
    const { value } = await reader.read();
    for (const line of new TextDecoder().decode(value).split('\n')) {
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
    }
  };
  await read();                                  // the greeting
  const before = wb.state.version;

  fs.writeFileSync(path.join(dir, 'src', 'things', 'domain', 'utils', 'more.utils.ts'),
    'export function more(): number { return 1; }\n');
  wb.rescan();
  await read();
  assert.strictEqual(wb.state.version, before + 1);
  assert.deepStrictEqual(events.at(-1), { version: before + 1 });
  const m = await (await get('/api/model')).json();
  assert.ok(m.bricks.some((b) => b.id === 'things/domain/utils/more.utils.ts'));

  const good = wb.state.model;
  const realRoot = cfg.root;
  cfg.root = 'missing';                          // makes the scan throw
  wb.rescan();
  cfg.root = realRoot;
  await read();
  assert.strictEqual(wb.state.model, good);
  assert.match(events.at(-1).error, /root not found/);
  ctrl.abort();
});

test('with watching on, saving a .ts file re-scans once per burst', async () => {
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-watch-'));
  fs.cpSync(path.join(__dirname, 'fixtures', 'wiring'), path.join(wdir, 'src'), { recursive: true });
  const live = createWorkbench(Object.assign({}, nestjs, { name: 'w', root: 'src', __dir: wdir }),
    { debounceMs: 50, log: () => {} });
  try {
    if (!live.state.watching) return;          // no recursive watch on this platform
    const v0 = live.state.version;
    const f = path.join(wdir, 'src', 'things', 'domain', 'utils', 'watched.utils.ts');
    fs.writeFileSync(f, 'export function a(): number { return 1; }\n');
    fs.appendFileSync(f, 'export function b(): number { return 2; }\n');
    for (let i = 0; i < 60 && live.state.version === v0; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));  // any second re-scan would have landed by now
    assert.strictEqual(live.state.version, v0 + 1);
    const b = live.state.model.bricks.find((x) => x.id === 'things/domain/utils/watched.utils.ts');
    assert.deepStrictEqual(b.studs.map((s) => s.name), ['a', 'b']);
  } finally {
    await live.close();
    fs.rmSync(wdir, { recursive: true, force: true });
  }
});

test('/api/change on a directory that is not a repository is a 400 that says why', async () => {
  const r = await get('/api/change');
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /not a git repository/);
});

test('/api/source?rev= answers only for a head this server scanned', async () => {
  const r = await get('/api/source?file=' + encodeURIComponent('things/domain/utils/date.utils.ts') + '&rev=' + 'a'.repeat(40));
  assert.strictEqual(r.status, 404);
});

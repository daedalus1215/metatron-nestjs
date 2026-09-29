'use strict';
/**
 * Spec 12 — the workbench serves a frontend and its linked backend as one
 * stack: ids namespaced fe:/be:, tiers stacked, HTTP calls as edges into the
 * backend, source for both trees.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('../src/config');
const { createWorkbench } = require('../src/serve');

const FIX = path.join(__dirname, 'fixtures');
let wb, base, m;
test.before(async () => {
  wb = createWorkbench(load(path.join(FIX, 'react')), { watch: false, log: () => {} });
  base = await wb.listen(0);
  m = await (await fetch(base + 'api/model')).json();
});
test.after(() => wb.close());

test('both sides, namespaced, with the backend tiers under the frontend ones', () => {
  assert.deepStrictEqual(m.sides, ['fe', 'be']);
  assert.ok(m.bricks.some((b) => b.id === 'fe:pages/ThingPage/ThingPage.tsx#ThingPage' && b.side === 'fe'));
  const action = m.bricks.find((b) => b.id === 'be:things/apps/actions/get-thing.action.ts#GetThingAction');
  assert.ok(action);
  const feTiers = m.tiers.filter((t) => t.side === 'fe').length;
  assert.ok(action.tier >= feTiers, 'backend bricks sit below every frontend tier');
  assert.strictEqual(m.tiers[action.tier].name, 'Entry');
});

test('a matched HTTP call is an edge into the backend action that owns the endpoint', () => {
  const c = m.calls.find((x) => x.kind === 'http' && x.fromMethod === 'fetchThing');
  assert.deepStrictEqual([c.from, c.to, c.toMethod],
    ['fe:api/requests/things.requests.ts', 'be:things/apps/actions/get-thing.action.ts#GetThingAction', 'execute']);
  const unmatched = m.calls.find((x) => x.kind === 'http' && x.fromMethod === 'pingMissing');
  assert.strictEqual(unmatched.to, null);
  assert.strictEqual(m.bridge.matched, 5);
});

test('backend wiring is kept, namespaced: the action still sits on its service', () => {
  assert.ok(m.wires.some((w) => w.from === 'be:things/apps/actions/get-thing.action.ts#GetThingAction'
    && w.to === 'be:things/domain/services/thing.service.ts#ThingService'));
});

test('source is served for both trees, by namespaced file', async () => {
  const fe = await fetch(base + 'api/source?file=' + encodeURIComponent('fe:api/requests/things.requests.ts'));
  const be = await fetch(base + 'api/source?file=' + encodeURIComponent('be:things/apps/actions/get-thing.action.ts'));
  assert.strictEqual(fe.status, 200);
  assert.strictEqual(be.status, 200);
  assert.match(await be.text(), /class GetThingAction/);
  const bare = await fetch(base + 'api/source?file=' + encodeURIComponent('api/requests/things.requests.ts'));
  assert.strictEqual(bare.status, 404, 'an un-namespaced path is not a file in the stack');
});

test('routes and the bridge travel with the stack', () => {
  assert.ok(m.routes.some((r) => r.path === '/things/:id' && r.component === 'fe:pages/ThingPage/ThingPage.tsx#ThingPage'));
  assert.deepStrictEqual(m.bridge.unreached.length, 3);
});

test('with watching on, saving a .tsx file re-scans the stack', async () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-stack-'));
  fs.cpSync(path.join(FIX, 'react'), path.join(dir, 'react'), { recursive: true });
  fs.cpSync(path.join(FIX, 'react-backend'), path.join(dir, 'react-backend'), { recursive: true });
  const live = createWorkbench(load(path.join(dir, 'react')), { debounceMs: 50, log: () => {} });
  try {
    if (!live.state.watching) return;
    const v0 = live.state.version;
    fs.writeFileSync(path.join(dir, 'react', 'src', 'components', 'Badge.tsx'), 'export const Badge = () => <b>new</b>;\n');
    for (let i = 0; i < 60 && live.state.version === v0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(live.state.version, v0 + 1);
    assert.ok(live.state.model.bricks.some((b) => b.id === 'components/Badge.tsx#Badge'));
  } finally {
    await live.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

'use strict';
/**
 * Spec 13 — stackCompare(): a change across a frontend and its backend. Pure:
 * four in-memory models, each frontend bridged to the backend of its own end.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const react = require('../src/defaults/react');
const { stackCompare } = require('../src/change');

const FIX = path.join(__dirname, 'fixtures');
const read = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
};

const bcfg = Object.assign({}, nestjs, { name: 'be', root: 'src', __dir: path.join(FIX, 'react-backend') });
const fcfg = Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(FIX, 'react'), aliases: { '@': 'src' }, apiPrefix: '/api' });
const beModel = (files) => scan(bcfg, { files });
const feModel = (files, be) => scan(fcfg, { files, backend: { model: be, label: 'be', cfg: bcfg } });

// ---- base: the fixtures as they are
const BE0 = read(path.join(FIX, 'react-backend', 'src'));
const FE0 = read(path.join(FIX, 'react', 'src'));

// ---- head: the change
const BE1 = Object.assign({}, BE0, {
  // a new endpoint
  'things/apps/actions/thing-tags.action.ts': `import { Controller, Get, Param } from '@nestjs/common';

@Controller('things')
export class ThingTagsAction {
  @Get(':id/tags')
  execute(@Param('id') id: number) { return [id]; }
}
`,
});
delete BE1['things/apps/actions/delete-thing.action.ts'];   // an endpoint removed, still called

const FE1 = Object.assign({}, FE0, {
  // a new hook calling the new endpoint: a new vein through the stack
  'pages/ThingPage/hooks/useThingTags.ts': `import api from '../../../api/axios';
export const useThingTags = async (id: number) => (await api.get(\`/things/\${id}/tags\`)).data;
`,
  // a new hook calling an existing endpoint
  'pages/ThingPage/hooks/useThingAgain.ts': `import api from '../../../api/axios';
export const useThingAgain = async (id: number) => (await api.get(\`/things/\${id}\`)).data;
`,
  // the old request module: a call to the new endpoint, and one to nothing
  'api/requests/things.requests.ts': FE0['api/requests/things.requests.ts'] + `
export const fetchTags = async (id: number) => {
  await api.get(\`/things/\${id}/tags\`);
};

export const fetchGhost = async () => {
  await api.get('/ghosts');
};
`,
});

const be0 = beModel(BE0), be1 = beModel(BE1);
const out = stackCompare(feModel(FE0, be0), feModel(FE1, be1), be0, be1);
const S = out.summary.stack;
const pair = (from, to) => out.pairs.find((p) => p.http && p.from === 'fe:' + from && p.to === 'be:' + to);

const REQ = 'api/requests/things.requests.ts';
const TAGS = 'things/apps/actions/thing-tags.action.ts#ThingTagsAction';
const GET1 = 'things/apps/actions/get-thing.action.ts#GetThingAction';
const DEL = 'things/apps/actions/delete-thing.action.ts#DeleteThingAction';

test('each side is compared, keyed fe: and be:', () => {
  assert.strictEqual(out.bricks['be:' + TAGS], 'added');
  assert.strictEqual(out.bricks['fe:pages/ThingPage/hooks/useThingTags.ts#useThingTags'], 'added');
  assert.strictEqual(out.bricks['fe:' + REQ], 'edited');
  assert.ok(out.removed.some((r) => r.id === 'be:' + DEL && r.side === 'be'));
});

test('a new caller of a new endpoint is territory: a new vein through the stack', () => {
  assert.strictEqual(pair('pages/ThingPage/hooks/useThingTags.ts#useThingTags', TAGS).class, 'territory');
});

test('a new caller of an existing endpoint is an attachment', () => {
  assert.strictEqual(pair('pages/ThingPage/hooks/useThingAgain.ts#useThingAgain', GET1).class, 'attachment');
});

test('an old request module calling a new endpoint is a graft', () => {
  assert.strictEqual(pair(REQ, TAGS).class, 'graft');
});

test('a removed endpoint: its pair detached, its call broken, with what it used to reach', () => {
  assert.strictEqual(pair(REQ, DEL).class, 'detached');
  assert.deepStrictEqual(S.endpointsRemoved, [{ id: 'DELETE /things/:id#execute', calledBy: ['fe:' + REQ] }]);
  const b = S.broken.find((x) => x.fromMethod === 'deleteThing');
  assert.deepStrictEqual([b.verb, b.path, b.was], ['DELETE', '/api/things/${id}', 'DELETE /things/:id#execute']);
});

test('a new call into nothing is broken, and was nothing', () => {
  const b = S.broken.find((x) => x.fromMethod === 'fetchGhost');
  assert.deepStrictEqual([b.verb, b.path, b.was, b.match], ['GET', '/ghosts', null, 'unmatched']);
});

test('calls that were already broken are not the change\'s doing', () => {
  // pingMissing (GET /nowhere) and fetchView (ambiguous) fail at both ends
  assert.ok(!S.broken.some((x) => x.fromMethod === 'pingMissing' || x.fromMethod === 'fetchView'));
  assert.deepStrictEqual(S.broken.map((x) => x.fromMethod).sort(), ['deleteThing', 'fetchGhost']);
});

test('endpoints added, with their callers', () => {
  assert.deepStrictEqual(S.endpointsAdded, [{ id: 'GET /things/:id/tags#execute',
    calledBy: ['fe:' + REQ, 'fe:pages/ThingPage/hooks/useThingTags.ts#useThingTags'] }]);
  assert.deepStrictEqual(S.http, { attachment: 1, graft: 1, rewire: 0, territory: 1, detached: 1 });
});

test('the merged summary counts both sides, and groups the stack pairs with the rest', () => {
  const s = out.summary;
  assert.strictEqual(s.removed, 1);
  assert.ok(s.grafts.some((g) => g.brick === 'fe:' + REQ && g.with.includes('be:' + TAGS)));
  assert.ok(s.attachments.some((a) => a.brick === 'be:' + GET1));
});

test('an unchanged stack changes nothing', () => {
  const fe = feModel(FE0, be0);
  const same = stackCompare(fe, fe, be0, be0);
  assert.deepStrictEqual(same.pairs, []);
  assert.deepStrictEqual([same.summary.stack.broken, same.summary.stack.endpointsAdded], [[], []]);
});

// ---------------------------------------------------------------- git
test('in one repository, each frame reads both sides from its own commit', () => {
  const os = require('os');
  const { execFileSync } = require('child_process');
  const { load } = require('../src/config');
  const { changeAt } = require('../src/change');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-stack-git-'));
  try {
    fs.cpSync(path.join(FIX, 'react'), path.join(repo, 'react'), { recursive: true });
    fs.cpSync(path.join(FIX, 'react-backend'), path.join(repo, 'react-backend'), { recursive: true });
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
    g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(repo, 'react-backend', 'src', 'things', 'apps', 'actions', 'thing-tags.action.ts'), BE1['things/apps/actions/thing-tags.action.ts']);
    g('add', '.'); g('commit', '-q', '-m', 'backend: tags endpoint');
    fs.writeFileSync(path.join(repo, 'react', 'src', 'pages', 'ThingPage', 'hooks', 'useThingTags.ts'), FE1['pages/ThingPage/hooks/useThingTags.ts']);
    fs.rmSync(path.join(repo, 'react-backend', 'src', 'things', 'apps', 'actions', 'delete-thing.action.ts'));
    g('add', '-A'); g('commit', '-q', '-m', 'frontend: use the tags; backend: drop delete');
    g('checkout', '-q', 'main');          // the working tree has neither change

    const cfg = load(path.join(repo, 'react'));
    const { change, model } = changeAt(cfg, { range: 'main...feat' });
    assert.strictEqual(change.stack, true);
    assert.ok(model.__backend.model.bricks.some((b) => b.id === TAGS), 'the backend was read from the commit');
    const st = change.summary.stack;
    assert.deepStrictEqual(st.endpointsAdded.map((e) => [e.id, e.calledBy]),
      [['GET /things/:id/tags#execute', ['fe:pages/ThingPage/hooks/useThingTags.ts#useThingTags']]]);
    assert.deepStrictEqual(st.endpointsRemoved.map((e) => e.id), ['DELETE /things/:id#execute']);
    assert.deepStrictEqual(st.broken.map((b) => [b.fromMethod, b.was]), [['deleteThing', 'DELETE /things/:id#execute']]);

    // frame 1: the backend commit alone — the endpoint exists, nothing calls it yet
    const f1 = changeAt(cfg, { range: 'main...feat' }, { frame: 1 }).change.summary.stack;
    assert.deepStrictEqual(f1.endpointsAdded, [{ id: 'GET /things/:id/tags#execute', calledBy: [] }]);
    assert.deepStrictEqual(f1.broken, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

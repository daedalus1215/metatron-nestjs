'use strict';
/**
 * Spec 14 — `metatron-nest diff` in a frontend reports what the change does
 * across the stack, reading the backend at both ends of the range.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../src/diff');
const { load } = require('../src/config');

const FIX = path.join(__dirname, 'fixtures');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-diff-stack-'));
const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
const FE = path.join(repo, 'react'), BE = path.join(repo, 'react-backend');
const ACTIONS = path.join(BE, 'src', 'things', 'apps', 'actions');

test.before(() => {
  fs.cpSync(path.join(FIX, 'react'), FE, { recursive: true });
  fs.cpSync(path.join(FIX, 'react-backend'), BE, { recursive: true });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-q', '-m', 'base');
  // a backend-only change that cuts a frontend call
  g('checkout', '-q', '-b', 'cut');
  fs.rmSync(path.join(ACTIONS, 'delete-thing.action.ts'));
  g('add', '-A'); g('commit', '-q', '-m', 'drop delete');
  // a full-stack feature: an endpoint, its caller, and a call to nothing
  g('checkout', '-q', '-b', 'feat', 'main');
  fs.writeFileSync(path.join(ACTIONS, 'thing-tags.action.ts'), `import { Controller, Get, Param } from '@nestjs/common';
@Controller('things')
export class ThingTagsAction {
  @Get(':id/tags')
  execute(@Param('id') id: number) { return [id]; }
}
`);
  fs.appendFileSync(path.join(FE, 'src', 'api', 'requests', 'things.requests.ts'),
    "\nexport const fetchTags = async (id: number) => { await api.get(`/things/${id}/tags`); };\n" +
    "export const fetchGhost = async () => { await api.get('/ghosts'); };\n");
  g('add', '-A'); g('commit', '-q', '-m', 'tags');
  // a backend-only rename of the body's field: the frontend's call drifts
  g('checkout', '-q', '-b', 'drift', 'main');
  const rename = path.join(ACTIONS, 'rename-thing.action.ts');
  fs.writeFileSync(rename, fs.readFileSync(rename, 'utf8').replace('body: { name: string }', 'body: { title: string }').replace('body.name', 'body.title'));
  g('commit', '-qam', 'rename the field');
  g('checkout', '-q', 'main');
});
test.after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('a backend-only change that cuts a frontend call is reported from the frontend', () => {
  const r = D.analyze(load(FE), { range: 'main...cut' });
  assert.strictEqual(r.files.total, 0, 'no frontend file changed');
  assert.deepStrictEqual(r.stack.broken.map((b) => [b.verb, b.path, b.file, b.was]),
    [['DELETE', '/api/things/${id}', 'api/requests/things.requests.ts', 'DELETE /things/:id']]);
  assert.deepStrictEqual(r.stack.endpointsRemoved, [{ endpoint: 'DELETE /things/:id', calledBy: ['api/requests/things.requests.ts'] }]);
  const text = D.renderTerminal(r);
  assert.match(text, /no files changed in the scanned root/);
  assert.match(text, /1 broken call {2}!/);
  assert.match(text, /reached DELETE \/things\/:id before this change/);
});

test('a full-stack feature: the endpoint with its caller, and the new call into nothing', () => {
  const r = D.analyze(load(FE), { range: 'main...feat' });
  assert.deepStrictEqual(r.stack.endpointsAdded, [{ endpoint: 'GET /things/:id/tags', calledBy: ['api/requests/things.requests.ts'] }]);
  assert.deepStrictEqual(r.stack.broken.map((b) => [b.path, b.was]), [['/ghosts', null]]);
  assert.deepStrictEqual(r.stack.http, { attachment: 0, graft: 1, rewire: 0, territory: 0, detached: 0 });
  // the broken call is also a new violation, in the diff
  assert.ok(r.architecture.added.some((v) => v.rule === 'http-broken' && v.to === 'GET /ghosts'));
  const md = D.renderMarkdown(r);
  assert.match(md, /\*\*Across the stack\*\* \(\.\.\/react-backend\)/);
  assert.match(md, /\n\*\*1 broken call\*\*\n- `GET \/ghosts`/);
  assert.match(md, /\n\nendpoints added: 1\n- `GET \/things\/:id\/tags`/);
});

test('a backend-only rename of a DTO field: the contract drift it causes', () => {
  const r = D.analyze(load(FE), { range: 'main...drift' });
  assert.deepStrictEqual(r.stack.contractDrift.map((d) => [d.verb, d.path, d.file, d.endpoint, d.response]),
    [['PATCH', '/things/${id}/name', 'api/requests/things.requests.ts', 'PATCH /things/:id/name', null]]);
  const text = D.renderTerminal(r);
  assert.match(text, /contract drift: 1 call whose declared shape no longer matches its endpoint's\n/);
  assert.match(text, /PATCH \/things\/\$\{id\}\/name {3}api\/requests\/things\.requests\.ts:\d+ {3}request: sends name \(undeclared\); missing title/);
  assert.match(D.renderMarkdown(r), /matches its endpoint's\n- `PATCH \/things\/\$\{id\}\/name` {3}api\/requests/);
  assert.match(D.renderTerminal(D.analyze(load(FE), { range: 'main...cut' })), /contract drift: none/);
});

test('--staged: the drift a staged backend change causes; an unstaged frontend fix does not count', () => {
  const rename = path.join(ACTIONS, 'rename-thing.action.ts');
  const req = path.join(FE, 'src', 'api', 'requests', 'things.requests.ts');
  try {
    fs.writeFileSync(rename, fs.readFileSync(rename, 'utf8').replace('body: { name: string }', 'body: { title: string }'));
    g('add', rename);
    fs.writeFileSync(req, fs.readFileSync(req, 'utf8').replace('await api.patch(url, { name });', 'await api.patch(url, { title: name });'));
    const r = D.analyze(load(FE), { staged: true });
    assert.strictEqual(r.range, 'staged changes');
    assert.deepStrictEqual(r.stack.contractDrift.map((d) => [d.verb, d.path, d.request.missing, d.request.extra]),
      [['PATCH', '/things/${id}/name', ['title'], ['name']]]);
  } finally {
    g('reset', '-q', '--hard');
  }
});

test('a frontend with no backend linked has no stack section', () => {
  const cfg = load(FE);
  delete cfg.backend;
  const r = D.analyze(cfg, { range: 'main...feat' });
  assert.strictEqual(r.stack, null);
  assert.doesNotMatch(D.renderTerminal(r), /across the stack/);
});

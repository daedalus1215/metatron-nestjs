'use strict';
/**
 * Spec 15 — contract drift in a change: what the change made differ, not
 * what already did.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const react = require('../src/defaults/react');
const { stackCompare, changeAt } = require('../src/change');
const { load } = require('../src/config');

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

const RENAME = 'things/apps/actions/rename-thing.action.ts';
const REQ = 'api/requests/things.requests.ts';
const BE0 = read(path.join(FIX, 'react-backend', 'src'));
const FE0 = read(path.join(FIX, 'react', 'src'));
// the DTO's field renamed, name → title
const BE1 = Object.assign({}, BE0, { [RENAME]: BE0[RENAME].replace('body: { name: string }', 'body: { title: string }').replace('body.name', 'body.title') });
// the frontend following it
const FE1 = Object.assign({}, FE0, { [REQ]: FE0[REQ].replace('await api.patch(url, { name });', 'await api.patch(url, { title: name });') });

const be0 = beModel(BE0), be1 = beModel(BE1);
const drift = (fe0, fe1, b0, b1) => stackCompare(feModel(fe0, b0), feModel(fe1, b1), b0, b1).summary.stack.contractDrift;

test("a backend-only rename: the request drift it causes, and what the call's contract was before", () => {
  const d = drift(FE0, FE0, be0, be1);
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual([d[0].fromMethod, d[0].verb, d[0].path, d[0].endpoint],
    ['renameThing', 'PATCH', '/things/${id}/name', 'PATCH /things/:id/name#execute']);
  assert.deepStrictEqual(d[0].request, { status: 'differ', extra: ['name'], missing: ['title'], optional: [] });
  assert.strictEqual(d[0].response, null);
  assert.deepStrictEqual(d[0].was, { request: 'agree', response: 'unread' });
});

test('both sides changed together: no drift', () => {
  assert.deepStrictEqual(drift(FE0, FE1, be0, be1), []);
});

test('drift that was there before the change is not its doing', () => {
  // fetchThing and friends send no body to an endpoint that requires one, at both ends
  const base = feModel(FE0, be0);
  assert.ok(base.calls.some((c) => c.fromMethod === 'fetchThing' && c.contract.request.status === 'differ'));
  assert.deepStrictEqual(drift(FE0, FE0, be0, be0), []);
});

// ---------------------------------------------------------------- a PR
test('a PR that renames a DTO field on the backend only reports it; one that changes both does not', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-contract-pr-'));
  try {
    fs.cpSync(path.join(FIX, 'react'), path.join(repo, 'react'), { recursive: true });
    fs.cpSync(path.join(FIX, 'react-backend'), path.join(repo, 'react-backend'), { recursive: true });
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
    const write = (rel, src) => fs.writeFileSync(path.join(repo, rel), src);
    g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-q', '-m', 'base');

    g('checkout', '-q', '-b', 'backend-only');
    write('react-backend/src/' + RENAME, BE1[RENAME]);
    g('commit', '-qam', 'backend: rename the field');

    g('checkout', '-q', '-b', 'both', 'main');
    write('react-backend/src/' + RENAME, BE1[RENAME]);
    write('react/src/' + REQ, FE1[REQ]);
    g('commit', '-qam', 'both sides: rename the field');
    g('checkout', '-q', 'main');

    const cfg = load(path.join(repo, 'react'));
    const one = changeAt(cfg, { range: 'main...backend-only' }).change.summary.stack.contractDrift;
    assert.deepStrictEqual(one.map((d) => [d.fromMethod, d.request.missing, d.request.extra]), [['renameThing', ['title'], ['name']]]);
    assert.deepStrictEqual(changeAt(cfg, { range: 'main...both' }).change.summary.stack.contractDrift, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

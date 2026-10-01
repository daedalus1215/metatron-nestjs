'use strict';
/**
 * Spec 14 — a frontend call that reaches no endpoint is a violation: check
 * fails on a new one, baseline can accept it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'metatron.js');
const FIX = path.join(__dirname, 'fixtures');

test('check gates broken frontend calls through the baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-check-http-'));
  try {
    fs.cpSync(path.join(FIX, 'react'), path.join(dir, 'react'), { recursive: true });
    fs.cpSync(path.join(FIX, 'react-backend'), path.join(dir, 'react-backend'), { recursive: true });
    const fe = path.join(dir, 'react');
    const run = (...args) => spawnSync('node', [BIN, ...args], { cwd: fe, encoding: 'utf8' });

    const b = run('baseline');
    assert.strictEqual(b.status, 0, b.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(fe, 'arch.baseline.json'), 'utf8'));
    const accepted = Object.values(doc.violations).filter((v) => v.rule === 'http-broken').map((v) => v.to).sort();
    assert.deepStrictEqual(accepted, ['GET /nowhere', 'GET /views/${view}']);

    assert.strictEqual(run('check').status, 0, 'the accepted broken calls pass');

    // a new call into nothing
    const req = path.join(fe, 'src', 'api', 'requests', 'things.requests.ts');
    fs.appendFileSync(req, "\nexport const fetchGhost = async () => { await api.get('/ghosts'); };\n");
    const c = run('check');
    assert.strictEqual(c.status, 1, c.stdout);
    assert.match(c.stdout, /http-broken/);
    assert.match(c.stdout, /GET \/ghosts/);

    assert.strictEqual(run('baseline', '--update').status, 0);
    assert.strictEqual(run('check').status, 0, 'accepted again');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a bridge there is no http-broken rule: a backend model is unchanged', () => {
  const scan = require('../src/scan');
  const { load } = require('../src/config');
  const m = scan(load(path.join(FIX, 'react-backend')));
  assert.ok(!m.findings.some((f) => f.id === 'http-broken'));
});

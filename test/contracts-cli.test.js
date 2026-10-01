'use strict';
/**
 * Spec 15 — on the command line: scan prints the contracts line, and
 * contract drift never fails check.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'metatron.js');
const FIX = path.join(__dirname, 'fixtures');

test('scan prints the contracts line; check is not failed by contract drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-contracts-'));
  try {
    fs.cpSync(path.join(FIX, 'react'), path.join(dir, 'react'), { recursive: true });
    fs.cpSync(path.join(FIX, 'react-backend'), path.join(dir, 'react-backend'), { recursive: true });
    const fe = path.join(dir, 'react');
    const run = (...args) => spawnSync('node', [BIN, ...args], { cwd: fe, encoding: 'utf8' });

    const s = run('scan');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.match(s.stdout, /contracts requests 5 compared · 4 differ · 0 unread {3}responses 0 compared · 0 differ · 5 unread/);
    assert.match(s.stdout, /\n {7}api\/requests\/things\.requests\.ts:\d+ GET \/things\/\$\{id\} · request: the endpoint requires a body; the frontend sends none; missing name\n/);

    assert.strictEqual(run('baseline').status, 0);
    const doc = JSON.parse(fs.readFileSync(path.join(fe, 'arch.baseline.json'), 'utf8'));
    assert.ok(!Object.values(doc.violations).some((v) => v.rule === 'contract-drift'), 'nothing to accept: it is not a violation');

    // one more drifting call: still passes
    const req = path.join(fe, 'src', 'api', 'requests', 'things.requests.ts');
    fs.appendFileSync(req, "\nexport const renameAgain = async (id: number) => { await api.patch(`/things/${id}/name`, { title: 'x' }); };\n");
    assert.match(run('scan').stdout, /contracts requests 6 compared · 5 differ/);
    const c = run('check');
    assert.strictEqual(c.status, 0, c.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

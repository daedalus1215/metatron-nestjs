'use strict';
/**
 * `metatron-nest skill`: installs the bundled skill into ~/.agents/skills by
 * default, or into <dir>/metatron-nest/ with --dest.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'metatron.js');
const run = (args, home) => execFileSync('node', [BIN, ...args], { env: Object.assign({}, process.env, { HOME: home }), encoding: 'utf8' });

test('installs into ~/.agents/skills/metatron-nest by default', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-skill-'));
  try {
    const out = run(['skill'], home);
    const f = path.join(home, '.agents', 'skills', 'metatron-nest', 'SKILL.md');
    assert.match(out, /installed /);
    assert.match(fs.readFileSync(f, 'utf8'), /^---\nname: metatron-nest\n/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--dest installs into <dir>/metatron-nest and says how to link it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-skill-'));
  try {
    const dir = path.join(home, 'skills', 'software-development');
    const out = run(['skill', '--dest', dir], home);
    assert.ok(fs.existsSync(path.join(dir, 'metatron-nest', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(home, '.agents')), 'nothing written to ~/.agents');
    assert.match(out, /ln -s .*metatron-nest .*\.agents\/skills\/metatron-nest/);
    assert.match(run(['skill', '--dest', dir], home), /^updated /);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

'use strict';
/**
 * Config discovery: arch.config.js, .cjs or .mjs, and an ES module default
 * export (a Vite frontend's package.json says "type": "module").
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('../src/config');

const project = (name, files) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-cfg-')), name);
  fs.mkdirSync(dir);
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  return dir;
};

test('arch.config.cjs is found, beside a "type": "module" package', () => {
  const dir = project('shop', { 'package.json': '{"type":"module"}', 'arch.config.cjs': "module.exports = { extends: 'react', root: 'src' };" });
  try {
    const cfg = load(dir);
    assert.deepStrictEqual([cfg.extends, cfg.wiring, path.basename(cfg.__file)], ['react', 'react', 'arch.config.cjs']);
  } finally { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); }
});

test('an ES module config: its default export is the config', () => {
  const dir = project('shop', { 'package.json': '{"type":"module"}', 'arch.config.js': "export default { extends: 'react', root: 'app' };" });
  try {
    const cfg = load(dir);
    assert.deepStrictEqual([cfg.extends, cfg.root], ['react', 'app']);
  } finally { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); }
});

test('a frontend/ folder is a container: the project is named after its parent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-cfg-'));
  const dir = path.join(root, 'shop', 'frontend');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'arch.config.cjs'), "module.exports = { extends: 'react' };");
  try {
    assert.strictEqual(load(dir).name, 'shop');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

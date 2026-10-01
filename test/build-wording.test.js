'use strict';
/**
 * The static views say what they show: a frontend's views say frontend and
 * React, a backend's say backend and NestJS.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scan = require('../src/scan');
const { load } = require('../src/config');
const { build } = require('../src/build');

const FIX = path.join(__dirname, 'fixtures');
const views = (dir) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-views-'));
  const l = console.log; console.log = () => {};
  try { build(scan(load(dir)), out, ['layers', 'city', 'atlas']); } finally { console.log = l; }
  const read = (n) => fs.readFileSync(path.join(out, n + '.html'), 'utf8');
  const html = { layers: read('layers'), city: read('city'), atlas: read('atlas') };
  fs.rmSync(out, { recursive: true, force: true });
  return html;
};

test("a frontend's views say frontend and React", () => {
  const v = views(path.join(FIX, 'react'));
  assert.match(v.layers, /Every file in the frontend/);
  assert.match(v.city, /city view of the .* frontend/);
  assert.match(v.atlas, /React · derived from/);
  assert.match(v.atlas, /every <span class="mono">\.ts and \.tsx<\/span> file under <span class="mono">src<\/span>/);
  assert.doesNotMatch(v.layers + v.city + v.atlas, /\{\{(side|stack|exts)\}\}/);
});

test("a backend's views still say backend and NestJS", () => {
  const v = views(path.join(FIX, 'react-backend'));
  assert.match(v.layers, /Every file in the backend/);
  assert.match(v.atlas, /NestJS · derived from/);
});

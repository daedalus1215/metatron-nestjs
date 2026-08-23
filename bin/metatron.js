#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('../src/config');
const scan = require('../src/scan');
const { build } = require('../src/build');

const args = process.argv.slice(2);
const cmd = ['scan', 'views', 'all'].includes(args[0]) ? args.shift() : 'all';

// A path argument lets you point metatron at a project instead of cd-ing into it.
// Anything else is treated as a lens-name filter.
let where = process.cwd();
const rest = [];
for (const a of args) {
  if (a.startsWith('-')) continue;
  if (!fs.existsSync(a)) { rest.push(a); continue; }
  const st = fs.statSync(a);
  if (st.isDirectory()) where = path.resolve(a);
  else if (path.basename(a) === 'arch.config.js') where = path.dirname(path.resolve(a));
  else rest.push(a);
}
const filter = rest;

let cfg;
try { cfg = load(where); } catch (e) { console.error(e.message); process.exit(1); }

const outDir = path.resolve(cfg.__dir, cfg.outDir || '.metatron');
fs.mkdirSync(outDir, { recursive: true });
const modelPath = path.join(outDir, 'model.json');

let model;
if (cmd === 'views' && fs.existsSync(modelPath)) {
  model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
} else {
  try { model = scan(cfg); } catch (e) { console.error('scan failed: ' + e.message); process.exit(1); }
  fs.writeFileSync(modelPath, JSON.stringify(model));
}

const c = model.coverage;
const skips = model.fileLinks.filter((l) => model.skipRules.some((r) => r.id === l[3])).length;
console.log(`metatron · ${model.project}`);
console.log(`  ${model.stats.files} files · ${model.stats.edges} imports · ${model.stats.nodes} directories · ${model.modules.length} modules`);
console.log(`  ${model.stats.endpoints} endpoints · ${model.stats.hops} traced hops`);
console.log(`  ${skips} layer-skipping links · ${model.findings.filter((f) => f.tone === 'warn').length} deviations · ${model.findings.filter((f) => f.tone === 'good').length} rules upheld`);
console.log(`  coverage ${c.classified}/${c.files} (${(100 - c.unclassifiedPct).toFixed(1)}%)${c.unclassifiedPct > 25 ? '  !!' : c.unclassifiedPct > 10 ? '  !' : ''}`);

if (c.unclassifiedPct > 10) {
  console.log(`\n  ${c.unclassifiedCount} files matched no pattern. Add them to \`addPatterns\` in ${path.relative(process.cwd(), cfg.__file)}:`);
  const bySuffix = {};
  for (const f of c.samples) {
    const m = path.basename(f).match(/(\.[a-z]+)?\.ts$/);
    const k = (m && m[1]) || '(no suffix)';
    (bySuffix[k] = bySuffix[k] || []).push(f);
  }
  for (const [suffix, list] of Object.entries(bySuffix).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${suffix.padEnd(14)} ${list.length}x   e.g. ${list[0]}`);
  }
}

if (cmd !== 'scan') {
  console.log('');
  for (const r of build(model, outDir, filter)) {
    if (r.ok) console.log(`  ${r.name.padEnd(11)} ${((r.bytes / 1024).toFixed(0) + ' KB').padStart(7)}  (data ${(r.dataBytes / 1024).toFixed(0)} KB, ${r.via})`);
    else console.log(`  ${r.name.padEnd(11)} FAILED — ${r.error}`);
  }
  const idx = path.join(outDir, 'index.html');
  const rel = path.relative(process.cwd(), idx);
  console.log(`\n  open ${rel.startsWith('..') ? idx : rel}`);
} else {
  const relModel = path.relative(process.cwd(), modelPath);
  console.log(`\n  -> ${relModel.startsWith('..') ? modelPath : relModel}`);
}

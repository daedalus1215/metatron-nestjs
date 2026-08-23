#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('../src/config');
const scan = require('../src/scan');
const { build } = require('../src/build');

const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`metatron — compile a NestJS backend into an architecture model and visual lenses

  metatron [path]           scan and build every lens
  metatron scan [path]      model only
  metatron views [path]     re-render from the cached model
  metatron views layers     one lens by name
  metatron skill            install the Claude skill into ~/.claude/skills
  metatron skill --where    print where the skill would be installed

Config lives in arch.config.js next to the src/ you want scanned.
Docs: https://github.com/daedalus1215/metatron-nestjs`);
  process.exit(0);
}

// Installs the bundled skill so a Claude session in any repo knows this tool
// exists. Kept explicit rather than a postinstall hook — nothing should write
// into a user's home directory as a side effect of npm install.
if (args[0] === 'skill') {
  const home = process.env.HOME || require('os').homedir();
  const dest = path.join(home, '.claude', 'skills', 'metatron', 'SKILL.md');
  if (args.includes('--where')) { console.log(dest); process.exit(0); }
  const srcSkill = path.resolve(__dirname, '..', 'skill', 'SKILL.md');
  if (!fs.existsSync(srcSkill)) { console.error('bundled skill missing at ' + srcSkill); process.exit(1); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const existed = fs.existsSync(dest);
  fs.copyFileSync(srcSkill, dest);
  console.log(`${existed ? 'updated' : 'installed'} ${dest}`);
  console.log('Start a new Claude session to pick it up.');
  process.exit(0);
}

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

#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('../src/config');
const scan = require('../src/scan');
const { build } = require('../src/build');
const BL = require('../src/baseline');
const { ungated } = require('../src/violations');

const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`metatron — compile a NestJS backend into an architecture model and visual lenses

  metatron [path]           scan and build every lens
  metatron scan [path]      model only
  metatron views [path]     re-render from the cached model
  metatron views layers     one lens by name
  metatron baseline [path]  record today's violations as accepted
  metatron baseline --update   rewrite it, keeping hand-written notes
  metatron check [path]     fail if new violations appeared since the baseline
  metatron diff [range]     blast radius of a change set
  metatron diff main...HEAD     explicit range
  metatron diff                 the default branch's merge base ... HEAD
  metatron diff --staged        what is about to be committed
  metatron skill            install the Claude skill into ~/.claude/skills
  metatron skill --where    print where the skill would be installed

check flags:
  --rule <id>        gate on this rule only (repeatable)
  --allow-new <n>    tolerate up to n new violations (default 0)
  --no-fixed         do not list violations fixed since the baseline
  --json             machine-readable result

diff flags:
  --format <name>    terminal (default), markdown, or json
  --json             shorthand for --format json

check exits 0 clean, 1 when new violations appeared, 2 on a tool or config error.
diff writes to stdout and exits 0; it is a report, not a gate.
The baseline lives beside arch.config.js as arch.baseline.json and is meant to
be committed - the output directory is generated and usually gitignored.

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

const cmd = ['scan', 'views', 'baseline', 'check', 'diff', 'all'].includes(args[0]) ? args.shift() : 'all';

// A path argument lets you point metatron at a project instead of cd-ing into it.
// Anything else is treated as a lens-name filter.
const flags = { rule: [], allowNew: 0, fixed: true, json: false, update: false, staged: false, format: null };
let where = process.cwd();
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--rule') { flags.rule.push(args[++i]); continue; }
  if (a.startsWith('--rule=')) { flags.rule.push(a.slice(7)); continue; }
  if (a === '--allow-new') { flags.allowNew = Number(args[++i]) || 0; continue; }
  if (a.startsWith('--allow-new=')) { flags.allowNew = Number(a.slice(12)) || 0; continue; }
  if (a === '--no-fixed') { flags.fixed = false; continue; }
  if (a === '--json') { flags.json = true; continue; }
  if (a === '--update') { flags.update = true; continue; }
  if (a === '--staged') { flags.staged = true; continue; }
  if (a.startsWith('--format=')) { flags.format = a.slice(9); continue; }
  if (a === '--format') { flags.format = args[++i]; continue; }
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

if (cfg.__nameWarning) console.warn('warning: ' + cfg.__nameWarning + '\n');

if (cmd === 'diff') {
  // A report, not a gate: nothing is written, and the exit code is not a
  // signal a pipeline should branch on.
  const D = require('../src/diff');
  const format = flags.json ? 'json' : (flags.format || 'terminal');
  if (!['terminal', 'markdown', 'json'].includes(format)) {
    console.error('unknown --format: ' + format + ' (use terminal, markdown or json)');
    process.exit(2);
  }
  let report;
  try { report = D.analyze(cfg, { range: filter[0] || null, staged: flags.staged }); }
  catch (e) { console.error('diff failed: ' + e.message); process.exit(2); }
  console.log(format === 'json' ? D.renderJson(report)
    : format === 'markdown' ? D.renderMarkdown(report)
    : D.renderTerminal(report));
  process.exit(0);
}

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

const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
};

if (cmd === 'baseline') {
  let existing;
  try { existing = BL.read(cfg); } catch (e) { console.error(e.message); process.exit(2); }
  if (existing && !flags.update) {
    console.error(
      `${rel(BL.fileFor(cfg))} already exists.\n` +
      'Run `metatron baseline --update` to rewrite it. Hand-written `note` fields are preserved.'
    );
    process.exit(2);
  }
  const r = BL.write(cfg, model, existing);
  console.log(`metatron · ${model.project}`);
  console.log(`  ${existing ? 'updated' : 'wrote'} ${rel(r.path)}`);
  console.log(`  ${r.count} violation${r.count === 1 ? '' : 's'} accepted` +
    (r.kept ? `, ${r.kept} note${r.kept === 1 ? '' : 's'} preserved` : ''));
  if (r.dropped) {
    console.log(`  ${r.dropped} note${r.dropped === 1 ? '' : 's'} dropped — the violation${r.dropped === 1 ? ' it' : 's they'} described no longer exists`);
  }
  const ung = ungated(model);
  if (ung.length) console.log(`  not gated, aggregate findings: ${ung.join(', ')}`);
  console.log('\n  Commit this file. `metatron check` fails when a violation appears that is not in it.');
  process.exit(0);
}

if (cmd === 'check') {
  let baseline;
  try { baseline = BL.read(cfg); } catch (e) { console.error(e.message); process.exit(2); }
  if (!baseline) {
    console.error(`No ${BL.FILENAME} beside ${rel(cfg.__file)}.\nCreate one with \`metatron baseline\`.`);
    process.exit(2);
  }
  const r = BL.compare(model, baseline, flags.rule);
  const failed = r.added.length > flags.allowNew;

  if (flags.json) {
    console.log(JSON.stringify({
      project: model.project, ok: !failed, allowNew: flags.allowNew,
      rules: flags.rule.length ? flags.rule : null,
      total: r.total, unchanged: r.unchanged,
      added: r.added, addedOutOfScope: r.addedOutOfScope, fixed: r.fixed,
    }, null, 2));
    process.exit(failed ? 1 : 0);
  }

  const pair = (v) => v.to ? `${v.from}\n${' '.repeat(26)}-> ${v.to}` : v.from;
  console.log(`metatron check · ${model.project}\n`);

  console.log(`  new violations        ${r.added.length}`);
  for (const v of r.added) console.log(`    ${v.rule.padEnd(22)}${pair(v)}`);
  if (r.addedOutOfScope.length) {
    console.log(`\n  new, outside --rule   ${r.addedOutOfScope.length}  (reported, not gated)`);
    for (const v of r.addedOutOfScope) console.log(`    ${v.rule.padEnd(22)}${pair(v)}`);
  }
  if (flags.fixed && r.fixed.length) {
    console.log(`\n  fixed since baseline  ${r.fixed.length}`);
    for (const v of r.fixed) console.log(`    ${v.rule.padEnd(22)}${pair(v)}`);
  }
  console.log(`\n  known, unchanged      ${r.unchanged}`);

  if (failed) {
    const n = r.added.length;
    console.log(`\nFAIL — ${n} new violation${n === 1 ? '' : 's'}` +
      (flags.allowNew ? ` (allowed ${flags.allowNew})` : '') +
      '. Fix it, or run `metatron baseline --update` to accept it.');
  } else if (r.fixed.length && flags.fixed) {
    // Not removed automatically: a scan that temporarily fails to parse a file
    // would otherwise retire a real debt, and it would return later as "new".
    console.log('\nPASS — no new violations. ' +
      `${r.fixed.length} fixed; run \`metatron baseline --update\` to record that.`);
  } else {
    console.log('\nPASS — no new violations.');
  }
  process.exit(failed ? 1 : 0);
}

const c = model.coverage;
const skips = model.fileLinks.filter((l) => model.skipRules.some((r) => r.id === l[3])).length;
console.log(`metatron · ${model.project}`);
console.log(`  ${model.stats.files} files · ${model.stats.edges} imports · ${model.stats.nodes} directories · ${model.modules.length} modules`);
console.log(`  ${model.stats.endpoints} endpoints · ${model.stats.hops} traced hops`);
console.log(`  ${skips} layer-skipping links · ${model.findings.filter((f) => f.tone === 'warn').length} deviations · ${model.findings.filter((f) => f.tone === 'good').length} rules upheld`);
console.log(`  coverage ${c.classified}/${c.files} (${(100 - c.unclassifiedPct).toFixed(1)}%)${c.unclassifiedPct > 25 ? '  !!' : c.unclassifiedPct > 10 ? '  !' : ''}`);

// A route we could not parse must be visible. Dropping it silently is how the
// two-space-indentation bug survived four projects unnoticed.
const D = model.diagnostics || [];
if (D.length) {
  console.log(`  ${D.length} scan diagnostic${D.length === 1 ? '' : 's'}  !`);
  const byKind = {};
  for (const d of D) (byKind[d.kind] = byKind[d.kind] || []).push(d);
  for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${kind}  ${list.length}x`);
    for (const d of list.slice(0, 3)) console.log(`      ${d.file}:${d.line}  ${d.detail}`);
    if (list.length > 3) console.log(`      ... ${list.length - 3} more`);
  }
}

// Test findings are only trusted when the reverse check passes: every spec
// must be claimed by exactly one source. Otherwise they suppress themselves
// and say so here, because a confident wrong coverage report is worse than none.
const T = model.tests;
if (T && T.meta) {
  if (!T.meta.reliable) {
    const un = T.meta.specFiles - T.meta.matched;
    console.log(`  ${un} of ${T.meta.specFiles} spec files could not be matched to a source file.  !!`);
    console.log(`    The \`testLocators\` config does not fit this project's layout.`);
    console.log(`    Test findings suppressed — they would be wrong.`);
    T.unmatchedSpecs.slice(0, 3).forEach((s) => console.log(`      ${s}`));
    if (T.unmatchedSpecs.length > 3) console.log(`      ... ${T.unmatchedSpecs.length - 3} more`);
  } else if (T.meta.specFiles === 0) {
    console.log(`  0 test files found — every source file counts as untested.`);
  }
}

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
  console.log(`\n  open ${rel(path.join(outDir, 'index.html'))}`);
} else {
  console.log(`\n  -> ${rel(modelPath)}`);
}

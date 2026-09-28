/**
 * Reads, writes and compares `arch.baseline.json`.
 *
 * The file lives next to `arch.config.js`, not in the output directory, because
 * the output directory is gitignored and a ratchet that is not committed cannot
 * hold a line.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { violationsOf } = require('./violations');

const FILENAME = 'arch.baseline.json';

const fileFor = (cfg) => path.join(cfg.__dir, FILENAME);

function read(cfg) {
  const p = fileFor(cfg);
  if (!fs.existsSync(p)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${p} is not valid JSON: ${e.message}`); }
  if (!parsed || typeof parsed.violations !== 'object' || parsed.violations === null) {
    throw new Error(`${p} has no "violations" object — delete it and re-run \`metatron baseline\`.`);
  }
  return parsed;
}

/**
 * Hand-written `note` fields survive an update. They are the only place the
 * reason a violation is tolerated gets recorded, and losing them on every
 * refresh is how a baseline decays into an unexamined list.
 */
function write(cfg, model, previous) {
  const prevNotes = {};
  if (previous) {
    for (const [fp, v] of Object.entries(previous.violations)) if (v.note) prevNotes[fp] = v.note;
  }
  const violations = {};
  let kept = 0;
  for (const v of violationsOf(model)) {
    violations[v.fingerprint] = { rule: v.rule, from: v.from, to: v.to };
    if (prevNotes[v.fingerprint]) { violations[v.fingerprint].note = prevNotes[v.fingerprint]; kept++; }
  }
  // A note whose violation is gone goes with it — but say so, rather than
  // counting it as preserved. Someone wrote that sentence for a reason.
  const dropped = Object.keys(prevNotes).length - kept;
  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: model.project,
    violations,
  };
  const p = fileFor(cfg);
  fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
  return { path: p, count: Object.keys(violations).length, kept, dropped };
}

/**
 * `rules` (optional) restricts the gate to named rule ids; everything else is
 * still reported, but advisory.
 */
function compare(model, baseline, rules) {
  const current = violationsOf(model);
  const known = baseline.violations;
  const inScope = (v) => !rules || !rules.length || rules.includes(v.rule);

  const added = current.filter((v) => !known[v.fingerprint]);
  const currentFps = new Set(current.map((v) => v.fingerprint));
  const fixed = Object.entries(known)
    .filter(([fp]) => !currentFps.has(fp))
    .map(([fingerprint, v]) => Object.assign({ fingerprint }, v));

  return {
    total: current.length,
    unchanged: current.length - added.length,
    added: added.filter(inScope),
    addedOutOfScope: added.filter((v) => !inScope(v)),
    fixed,
  };
}

module.exports = { read, write, compare, fileFor, FILENAME };

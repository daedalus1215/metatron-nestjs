/**
 * Flattens the model's warn-toned findings into individually addressable
 * violations, each with a stable fingerprint.
 *
 * A count per rule cannot name the offender, and it passes a swap — one
 * violation fixed and another introduced in the same change nets to zero. A
 * fingerprint per instance can say which, and catches the swap.
 *
 * Findings marked `gate: false` are aggregate observations about the tree
 * (`dag` reports SCC totals, `app-apps` reports a spelling split). They are
 * worth printing and meaningless to ratchet, so they never become violations.
 */
'use strict';

const crypto = require('crypto');

/** Stable across runs and machines; short enough to read in a diff. */
function fingerprint(rule, from, to) {
  return crypto.createHash('sha1').update(`${rule}|${from}|${to}`).digest('hex').slice(0, 12);
}

function violationsOf(model) {
  const sevOf = {};
  for (const r of model.skipRules || []) sevOf[r.id] = r.sev;

  const out = [];
  const seen = new Set();
  for (const f of model.findings || []) {
    if (f.tone !== 'warn' || f.gate === false) continue;
    for (const inst of f.instances || []) {
      const from = inst.from || '';
      const to = inst.to || '';
      const fp = fingerprint(f.id, from, to);
      if (seen.has(fp)) continue;          // the same edge can satisfy two rules
      seen.add(fp);
      out.push({ fingerprint: fp, rule: f.id, from, to, sev: sevOf[f.id] || 'warn' });
    }
  }
  out.sort((a, b) => a.rule.localeCompare(b.rule) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return out;
}

/**
 * Findings that are warn-toned but carry no instances. Reported so a rule
 * cannot quietly sit outside the gate without anyone noticing.
 */
function ungated(model) {
  return (model.findings || [])
    .filter((f) => f.tone === 'warn' && (f.gate === false || !f.instances))
    .map((f) => f.id);
}

module.exports = { fingerprint, violationsOf, ungated };

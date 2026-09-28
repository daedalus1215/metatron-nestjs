/**
 * Flyover adapter — one tower per module, one floor per directory.
 * Reduces the full scan to just what the 3D city needs.
 */
'use strict';

const path = require('path');

const SHOW_TIER_MAX = 8; // Entry .. Wiring; platform and tests are not towers

module.exports = function flyover(D) {
  const nodesByMod = {};
  for (const n of D.nodes) {
    if (n.tier > SHOW_TIER_MAX) continue;
    (nodesByMod[n.module] = nodesByMod[n.module] || []).push({
      id: n.id, label: n.label, tier: n.tier, count: n.count, patterns: n.patterns,
      files: n.files.map((f) => ({ f: f.f.slice(n.id.length + 1) || f.f, p: f.p })),
    });
  }

  // findings are reported as file paths, so a tower can carry its own deviations
  const modFindings = {};
  for (const f of D.findings) {
    if (f.tone !== 'warn') continue;
    for (const item of f.items) {
      const m = String(item).match(/^([a-z0-9.-]+)\//i);
      if (!m) continue;
      const list = (modFindings[m[1]] = modFindings[m[1]] || []);
      if (!list.some((x) => x.id === f.id)) list.push({ id: f.id, title: f.title });
    }
  }

  const modules = Object.keys(nodesByMod).map((m) => {
    const floors = nodesByMod[m]
      .slice()
      .sort((a, b) => b.tier - a.tier || a.label.localeCompare(b.label));
    const tiersPresent = [...new Set(floors.map((n) => n.tier))].sort((a, b) => a - b);
    return {
      id: m,
      files: floors.reduce((a, n) => a + n.count, 0),
      floors,
      tiersPresent,
      absent: D.tiers.slice(0, 9).map((t) => t.i).filter((i) => !tiersPresent.includes(i)),
      findings: modFindings[m] || [],
      endpoints: D.endpoints.filter((e) => e.module === m).length,
    };
  }).sort((a, b) => b.files - a.files);

  return {
    generatedAt: D.generatedAt,
    stats: D.stats,
    tiers: D.tiers.slice(0, 9),
    modules,
    domainEdges: D.domainEdges,
    findings: D.findings,
    ports: D.ports.map((p) => ({
      name: path.basename(p.path),
      owner: p.owner,
      consumers: p.consumers.filter((c) => c.pattern !== 'module').map((c) => c.module + ' · ' + c.pattern),
    })),
    crossDomain: D.crossDomain,
    endpoints: D.endpoints.map((e) => ({
      v: e.verb, r: e.route, m: e.module, f: e.file, c: e.cls, h: e.handler,
      ret: e.ret, dto: e.dto ? e.dto.type : null,
      hops: e.flat.map((n) => ({ c: n.cls, k: n.kind, mth: n.method, d: n.depth, m: n.module })),
    })),
  };
};

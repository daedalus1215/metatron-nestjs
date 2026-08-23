/**
 * Layer-stack adapter — every file placed on the plane of its architectural tier,
 * clustered by module. Cluster centres are identical on every plane, so a module
 * reads as a vertical silo through the stack.
 */
'use strict';

const CORE = [0, 1, 2, 3, 4, 5, 6, 7];   // Entry .. Domain Model
const EXTRA = [8, 9, 10];                 // Wiring, Platform, Test — behind a toggle
const GOLDEN = 2.39996;
const RING = 62;

module.exports = function layers(D) {
  const shown = new Set(CORE.concat(EXTRA));
  const nodes = D.fileNodes.map((n, i) => ({ ...n, i })).filter((n) => shown.has(n.t));

  // module cluster centres, biggest first, on a golden-angle ring so they never collide
  const modCount = {};
  for (const n of nodes) modCount[n.m] = (modCount[n.m] || 0) + 1;
  const mods = Object.keys(modCount).sort((a, b) => modCount[b] - modCount[a]);
  const centres = {};
  mods.forEach((m, k) => {
    const a = k * GOLDEN;
    const r = RING * Math.sqrt((k + 0.6) / mods.length);
    centres[m] = { x: Math.cos(a) * r, z: Math.sin(a) * r };
  });

  // phyllotaxis placement inside each (plane, module) cell
  const cells = {};
  for (const n of nodes) (cells[n.t + '|' + n.m] = cells[n.t + '|' + n.m] || []).push(n);
  for (const list of Object.values(cells)) {
    list.sort((a, b) => a.f.localeCompare(b.f));
    const c = centres[list[0].m];
    const spread = 2.6 + Math.sqrt(list.length) * 2.5;
    list.forEach((n, j) => {
      const a = j * GOLDEN;
      const r = spread * Math.sqrt((j + 0.5) / list.length);
      n.x = c.x + Math.cos(a) * r;
      n.z = c.z + Math.sin(a) * r;
    });
  }

  const present = {};
  for (const n of nodes) present[n.i] = true;
  const links = D.fileLinks.filter((l) => present[l[0]] && present[l[1]]);

  // severity: a file that originates a layer-skipping link, or is named in a finding
  const ruleSev = {};
  for (const r of D.skipRules) ruleSev[r.id] = r.sev;
  const sev = {};
  for (const l of links) {
    const s = ruleSev[l[3]];
    if (s === 'crit') sev[l[0]] = 'crit';
    else if (s === 'warn' && sev[l[0]] !== 'crit') sev[l[0]] = 'warn';
  }
  const flagged = {};
  for (const f of D.findings) {
    if (f.tone !== 'warn') continue;
    for (const it of f.items) {
      const m = String(it).match(/^([\w./-]+\.ts)/);
      if (m) (flagged[m[1]] = flagged[m[1]] || []).push(f.title);
    }
  }
  for (const n of nodes) {
    n.s = sev[n.i] || (flagged[n.f] ? 'warn' : 'ok');
    n.w = flagged[n.f] || [];
  }

  const extent = Math.max(...nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.z)))) + 12;

  const planes = [...shown].sort((a, b) => a - b).map((t) => {
    const ns = nodes.filter((n) => n.t === t);
    const byMod = {};
    for (const n of ns) byMod[n.m] = (byMod[n.m] || 0) + 1;
    return {
      t, name: D.tiers[t].name, sub: D.tiers[t].sub, count: ns.length,
      extra: EXTRA.includes(t),
      modules: Object.keys(byMod).sort((a, b) => byMod[b] - byMod[a]).map((m) => ({ m, n: byMod[m] })),
      patterns: [...new Set(ns.map((n) => n.p))].sort(),
    };
  });

  return {
    generatedAt: D.generatedAt,
    stats: D.stats,
    tiers: D.tiers,
    extent,
    planes,
    modules: mods.map((m) => ({ m, n: modCount[m], x: centres[m].x, z: centres[m].z })),
    nodes: nodes.map((n) => ({
      i: n.i, f: n.f, m: n.m, p: n.p, t: n.t, cls: n.cls, loc: n.loc,
      x: +n.x.toFixed(2), z: +n.z.toFixed(2), s: n.s, w: n.w,
    })),
    links,
    findings: D.findings,
    skipRules: D.skipRules,
  };
};

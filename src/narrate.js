/**
 * Turns a measured model into sentences.
 *
 * Every lens used to carry its interpretation as typed prose, which meant the
 * charts updated for a new project and the paragraphs kept describing the old
 * one. Nothing here is written by hand about any particular codebase: each
 * sentence is assembled from what the scan actually found, so it cannot
 * contradict the picture beside it.
 *
 * Templates opt in with `<p data-narr="layering"></p>`. A slot with nothing to
 * say is removed rather than left empty.
 */
'use strict';

const mono = (s) => `<span class="mono">${s}</span>`;
const strong = (s) => `<strong>${s}</strong>`;

function list(items, max = 3) {
  const shown = items.slice(0, max).map(mono);
  const rest = items.length - shown.length;
  if (!shown.length) return '';
  if (rest > 0) return shown.join(', ') + `, and ${rest} other${rest === 1 ? '' : 's'}`;
  if (shown.length === 1) return shown[0];
  return shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
}
/** Pluralises the kinds of nouns that show up in pattern ids. */
function s_(word) {
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}
function plural(n, one, many) { return n === 1 ? one : (many || s_(one)); }
/** "a repository" / "3 repositories" */
function count(n, noun) { return n === 1 ? `1 ${noun}` : `${n} ${s_(noun)}`; }
const num = (n) => n.toLocaleString('en-US');

module.exports = function narrate(m) {
  const N = {};
  const tierName = (i) => (m.tiers[i] || {}).name || '?';
  const warn = m.findings.filter((f) => f.tone === 'warn');
  const good = m.findings.filter((f) => f.tone === 'good');
  const ruleById = {};
  for (const r of m.skipRules) ruleById[r.id] = r;

  // ---------- scale ----------
  N.scale = `${strong(num(m.stats.files) + ' files')} under the scanned root, wired together by ` +
    `${num(m.stats.edges)} internal imports across ${num(m.stats.nodes)} directories and ` +
    `${m.modules.length} ${plural(m.modules.length, 'module')}.` +
    (m.stats.endpoints ? ` ${num(m.stats.endpoints)} HTTP ${plural(m.stats.endpoints, 'endpoint')} were traced through ${num(m.stats.hops)} call hops.` : '');

  // ---------- the intended flow ----------
  N.flow = m.flow && m.flow.length
    ? `Read left to right and it is the intended request path: ${m.flow.map(mono).join(' → ')}. ` +
      `Anything that jumps a station is a layering violation, and the lenses colour it as one.`
    : '';

  // ---------- layering ----------
  const skips = m.fileLinks.filter((l) => ruleById[l[3]]);
  const crit = skips.filter((l) => ruleById[l[3]].sev === 'crit');
  if (skips.length) {
    const byRule = {};
    for (const l of skips) byRule[l[3]] = (byRule[l[3]] || 0) + 1;
    const worst = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
    const fileOf = (i) => m.fileNodes[i];
    const critModules = [...new Set(crit.map((l) => fileOf(l[0]).m))];
    N.layering = `${strong(num(skips.length) + ' ' + plural(skips.length, 'link') + ' skip a layer')} — ` +
      worst.map(([id, n]) => `${n} where ${ruleById[id].why.toLowerCase()}`).join(', ') + '. ' +
      (crit.length
        ? (crit.length === 1
            ? `The most severe one starts in ${list(critModules)}.`
            : `The ${crit.length} most severe start in ${list(critModules)}.`)
        : 'None of them jumps more than a single station.');
  } else {
    N.layering = `${strong('No import skips a layer.')} Every dependency either stays within a tier or moves to the next one, which is what ` +
      (m.flow || []).map(mono).join(' → ') + ' asks for.';
  }

  // ---------- cross-context ----------
  const cd = m.crossDomain || [];
  if (cd.length) {
    const byTarget = {};
    for (const e of cd) byTarget[e.tp] = (byTarget[e.tp] || 0) + 1;
    const parts = Object.entries(byTarget).sort((a, b) => b[1] - a[1])
      .map(([p, n]) => count(n, p === 'other' ? 'unclassified file' : p));
    const bypass = m.findings.find((f) => f.id === 'cross-domain' && f.tone === 'warn');
    N.crossDomain = `${num(cd.length)} ${plural(cd.length, 'dependency', 'dependencies')} cross a bounded context — ${parts.join(', ')}. ` +
      (bypass
        ? `${strong(bypass.items.length + ' of them bypass the allowed gateways')}, which is the boundary rule this codebase sets for itself.`
        : `${strong('Every one lands on an allowed gateway')} — nothing reaches an entity, a repository or a use-case script in another context.`);
  } else {
    N.crossDomain = 'No import crosses a bounded context. The modules are fully independent of one another.';
  }

  // ---------- absent tiers ----------
  const absent = m.findings.find((f) => f.id === 'absent-patterns');
  if (absent && absent.items.length) {
    const names = absent.items.map((s) => String(s).split(' ')[0]);
    N.absent = `${strong(list(names, 4) + ' ' + plural(names.length, 'is', 'are') + ' configured but ' + plural(names.length, 'exists', 'exist') + ' nowhere in the code')}. ` +
      `Either the architecture document describes a shape that was never built, or the config names something this project does not use.`;
  }

  // ---------- module shape ----------
  const coreTiers = m.tiers.slice(0, Math.max(0, m.tiers.length - 3));
  const shapes = m.modules.map((mod) => {
    const present = new Set(m.nodes.filter((n) => n.module === mod.id).map((n) => n.tier));
    return { id: mod.id, files: mod.files, present, missing: coreTiers.filter((t) => !present.has(t.i)) };
  });
  const domainShapes = shapes.filter((s) => (m.domainModules || []).includes(s.id));
  const fullest = domainShapes.slice().sort((a, b) => a.missing.length - b.missing.length)[0];
  const oddest = domainShapes.slice().sort((a, b) => b.missing.length - a.missing.length)[0];
  if (fullest && oddest && oddest.missing.length) {
    N.skyline = `Height is layers, not importance: a module carries one floor per directory, stacked in architectural order, so ` +
      `${strong('its silhouette is its layer profile')}. ` +
      `${mono(fullest.id)} is the most complete, carrying ${fullest.present.size} of ${coreTiers.length} tiers. ` +
      `${mono(oddest.id)} is the outlier, missing ${list(oddest.missing.map((t) => t.name), 4)}.`;
    if (oddest.missing.length === coreTiers.length) N.skyline = '';
    const noEntry = domainShapes.filter((s) => !s.present.has(0));
    if (noEntry.length) {
      N.skyline += ` ${list(noEntry.map((s) => s.id), 3)} ${plural(noEntry.length, 'has', 'have')} no ${tierName(0)} floor at all — no route reaches ${plural(noEntry.length, 'it', 'them')} directly.`;
    }
  }

  // ---------- cycles ----------
  const c = m.cycles || {};
  if (c.domain && c.allEdges) {
    N.cycles = c.domain.length === 0
      ? `Taken raw, the module graph has ${c.allEdges.length} strongly-connected ${plural(c.allEdges.length, 'component')}. ` +
        `Set aside module wiring, port imports and shared-kernel join entities — the carve-outs the architecture sanctions — and ` +
        `${strong('the graph is acyclic')}.`
      : `${strong('The module graph still has ' + c.domain.length + ' ' + plural(c.domain.length, 'cycle') + ' after the sanctioned carve-outs')} ` +
        `(${c.domain.map((g) => '{' + g.join(', ') + '}').join(', ')}), so the dependency direction is not fully one-way.`;
  }

  // ---------- rules upheld ----------
  if (good.length) {
    N.upheld = `${strong(good.length + ' of the rules this codebase writes down for itself hold across all ' + num(m.stats.edges) + ' imports')}: ` +
      good.map((f) => f.title.replace(/\.$/, '')).join('; ') + '.';
  }

  // ---------- deviations summary ----------
  N.deviations = warn.length
    ? `${strong(warn.length + ' ' + plural(warn.length, 'kind', 'kinds') + ' of deviation')} were found, covering ` +
      `${warn.reduce((a, f) => a + f.items.length, 0)} files or imports in total. Each is measured against a stated rule, not against taste.`
    : `${strong('No deviations.')} Every rule the configuration encodes is upheld.`;

  // ---------- endpoints ----------
  if (m.stats.endpoints) {
    const serviceTier = (m.flow || []).indexOf('service');
    const noService = m.endpoints.filter((e) =>
      !e.flat.some((n) => n.kind === 'service') && e.flat.length);
    N.endpoints = `${num(m.stats.endpoints)} ${plural(m.stats.endpoints, 'endpoint')}, traced by following ` +
      `${mono('this.x.y()')} through real method bodies rather than guessed from the folder layout.` +
      (serviceTier > 0 && noService.length
        ? ` ${strong(noService.length + ' of them never touch a Service')}, leaving a visible gap in that column.`
        : '');
  }

  // ---------- data model ----------
  const dm = m.dataModel;
  if (dm && dm.stats.entities) {
    const t = dm.stats;
    if (!dm.relations.length) {
      N.schema = `${t.entities} ${plural(t.entities, 'entity', 'entities')} with ${t.columns} columns between them, and no references at all — every table stands alone.`;
    } else {
      N.schema = `${t.entities} ${plural(t.entities, 'entity', 'entities')}, ${t.columns} columns, ` +
        `${dm.relations.length} ${plural(dm.relations.length, 'reference')} between them. ` +
        (t.inferred
          ? `${strong(t.declared + ' ' + plural(t.declared, 'is', 'are') + ' declared to the ORM; ' + t.inferred + ' exist only as a bare id column')}. ` +
            (t.crossContext
              ? `${t.crossContext} cross a bounded context — which is usually the reason the relation was left undeclared, since declaring it would couple the two contexts. The dependency is still there; it is just the application's job to honour it rather than the database's.`
              : 'None of them crosses a bounded context.')
          : `All ${t.declared} are declared to the ORM.`);
      if (t.untabled) {
        N.schema += ` ${t.untabled} ${plural(t.untabled, 'entity', 'entities')} ${plural(t.untabled, 'does', 'do')} not name ${plural(t.untabled, 'its', 'their')} table in ${mono('@Entity()')}, so the name comes from the class.`;
      }
    }
  }

  // ---------- hotspots ----------
  if (m.churnMeta && m.churnMeta.available) {
    const fanIn = {};
    for (const l of m.fileLinks) fanIn[l[1]] = (fanIn[l[1]] || 0) + 1;
    const pts = m.fileNodes.map((n, i) => {
      const c = m.churn[n.f];
      if (!c) return null;
      return { f: n.f, p: n.p, commits: c.commits, deps: fanIn[i] || 0 };
    }).filter(Boolean).filter((x) => !['spec', 'test-util', 'migration'].includes(x.p));
    pts.forEach((x) => { x.score = x.commits * (1 + x.deps); });
    pts.sort((a, b) => b.score - a.score);
    const top = pts[0];
    if (top) {
      const busiest = pts.slice().sort((a, b) => b.commits - a.commits)[0];
      const central = pts.slice().sort((a, b) => b.deps - a.deps)[0];
      N.hotspots = `Across ${num(m.churnMeta.commits)} commits, the file scoring highest on both axes is ` +
        `${mono(top.f)} — ${strong(top.commits + ' ' + plural(top.commits, 'commit') + ' and ' + top.deps + ' ' + plural(top.deps, 'dependent'))}. ` +
        (busiest.f !== top.f ? `${mono(busiest.f)} changes most often (${busiest.commits}), ` : '') +
        `${mono(central.f)} is depended on by the most files (${central.deps}). ` +
        `A file high on one axis alone is usually fine; it is the overlap that costs.`;
      if (m.tests && m.tests.meta && m.tests.meta.reliable) {
        const ringed = pts.filter((x) => !m.tests.bySource[x.f]).length;
        N.hotspots += ` ${num(ringed)} of the ${num(pts.length)} files with history have no test file — the dashed rings — and a ring in the corner is where to test first. ` +
          `"Tested" means a spec file was located by name, not that the spec asserts anything: presence, not quality.`;
      }
    }
  }

  // ---------- provenance, shown on every lens ----------
  N.provenance = `Generated from ${mono(m.project)} by metatron. Every box is a directory that exists and every line is an ` +
    `${mono('import')} that a file actually writes. ${m.coverage.classified} of ${m.coverage.files} files ` +
    `(${(100 - m.coverage.unclassifiedPct).toFixed(1)}%) matched a configured pattern.`;

  N.caveats = `Imports are not calls: a type-only import counts the same as a constructor injection everywhere except the endpoint traces. ` +
    `Anything resolved through a DI token string rather than an imported symbol leaves no edge, so coupling is understated. ` +
    `Positions and footprints are chosen for legibility — only heights, tiers, links and colours carry meaning.`;

  return N;
};

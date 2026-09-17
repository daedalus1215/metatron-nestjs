/**
 * Hotspots adapter — the file graph plus its git history. Endpoints, the folder
 * graph and the data model are not read by this lens, so they are not shipped.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  project: D.project,
  root: D.root,
  stats: D.stats,
  coverage: D.coverage,
  tiers: D.tiers,
  fileNodes: D.fileNodes,
  fileLinks: D.fileLinks,
  churn: D.churn,
  churnMeta: D.churnMeta,
  // Only when the reverse check passed — an unreliable locator must not draw
  // rings it cannot stand behind.
  tests: D.tests && D.tests.meta && D.tests.meta.reliable ? D.tests : null,
  findings: D.findings.filter((f) => f.id === 'hotspots'),
});

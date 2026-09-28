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
  findings: D.findings.filter((f) => f.id === 'hotspots'),
});

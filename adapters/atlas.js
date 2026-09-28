/**
 * Atlas adapter — the folder map and conformance ledger.
 * Fields derived from what templates/atlas.html actually reads.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  stats: D.stats,
  tiers: D.tiers,
  nodes: D.nodes,
  edges: D.edges,
  modules: D.modules,
  domainModules: D.domainModules,
  platformModules: D.platformModules,
  ports: D.ports,
  crossDomain: D.crossDomain,
  shape: D.shape,
  findings: D.findings,
});

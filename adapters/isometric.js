/**
 * Isometric adapter — module towers built from folder nodes.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  tiers: D.tiers,
  nodes: D.nodes,
  modules: D.modules,
  domainEdges: D.domainEdges,
});

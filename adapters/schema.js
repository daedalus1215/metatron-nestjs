/**
 * Schema adapter — the data model only. Nothing else on the page reads the
 * import graph, so none of it is shipped.
 */
'use strict';

module.exports = (D) => ({
  generatedAt: D.generatedAt,
  project: D.project,
  root: D.root,
  stats: D.stats,
  coverage: D.coverage,
  dataModel: D.dataModel,
});

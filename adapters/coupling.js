/**
 * Coupling adapter — the co-change pairs plus the minimum of graph needed to
 * explain them: file modules (for the matrix axes and the cross-module read)
 * and module-level import edges (for the overlay). Endpoints, the folder
 * graph and the data model are not read by this lens, so they are not shipped.
 */
'use strict';

module.exports = (D) => {
  // Which modules the import graph connects — a matrix cell between two
  // modules that share an import edge is explained by the graph, and the
  // unexplained ones are the point of the lens.
  const modEdge = new Set();
  for (const l of D.fileLinks) {
    const a = D.fileNodes[l[0]].m, b = D.fileNodes[l[1]].m;
    if (a === b) continue;
    modEdge.add(a < b ? a + '\u0000' + b : b + '\u0000' + a);
  }
  return {
    generatedAt: D.generatedAt,
    project: D.project,
    root: D.root,
    coupling: D.coupling,
    fileNodes: D.fileNodes,
    modules: D.modules,
    moduleImports: [...modEdge],
  };
};

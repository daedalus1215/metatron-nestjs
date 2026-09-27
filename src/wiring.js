'use strict';
/**
 * The wiring model — bricks, sockets, studs (spec 09).
 *
 * A brick is the smallest unit that can be wired: a class, a file of
 * exported functions, or a port that declares a shape with no body. Its id
 * always carries its file path, because git, `diff` and `?focus=` all work in
 * files; `#Class` is what lets two classes share an address.
 */

/**
 * Bricks for every scanned file outside the Test tier. Test doubles are
 * classes too, but drawing them beside the code they stand in for would
 * double every part.
 *
 * @param ctx { files, info, decl, tiers } — `decl[rel]` is `classes.parse`
 *            output, `tiers` the model's tier list.
 */
function bricksOf(ctx) {
  const { files, info, decl, tiers } = ctx;
  const testTier = tiers.findIndex((t) => t.name === 'Test');
  const bricks = [];
  for (const rel of files) {
    const fi = info[rel];
    if (fi.tier === testTier) continue;
    const d = decl[rel];
    const base = { file: rel, module: fi.module, pattern: fi.pattern, tier: fi.tier };
    for (const c of d.classes) {
      bricks.push(Object.assign({ id: rel + '#' + c.name, name: c.name, shape: 'class' }, base, {
        lines: [c.start, c.end], decorators: c.decorators, extends: c.extends,
      }));
    }
    // A file of exported functions is one brick, whether or not it also
    // declares classes: its functions are studs no class brick would carry.
    const exported = d.functions.filter((f) => f.exported);
    if (exported.length) {
      bricks.push(Object.assign({ id: rel, name: baseName(rel), shape: 'functions' }, base, {
        lines: [1, fi.loc], decorators: [], extends: null,
      }));
    } else if (!d.classes.length && fi.pattern === 'port') {
      // A port is a hollow brick: a shape with no body. Leaving it out would
      // hide the indirection spec 05 preserves.
      bricks.push(Object.assign({ id: rel, name: baseName(rel), shape: 'port' }, base, {
        lines: [1, fi.loc], decorators: [], extends: null,
      }));
    }
  }
  return bricks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const baseName = (rel) => rel.split('/').pop().replace(/\.ts$/, '');

module.exports = { bricksOf };

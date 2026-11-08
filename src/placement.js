'use strict';
/**
 * Placement (spec 16): where a file lives, against the code that uses it.
 *
 * This part finds each file's kind, its users and its owner, and each
 * station's own folder. Verdicts come later. It is a pure function of the
 * files' patterns and the import links, so it can be asked "what if this
 * file had one more user" (spec 18) by passing one more link.
 *
 * Files are fileNodes indices throughout, the way fileLinks are.
 */
const posix = require('path').posix;

const dirOf = (f) => (posix.dirname(f) === '.' ? '' : posix.dirname(f));
const parentOf = (d) => (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '');
const stemOf = (f) => posix.basename(f).split('.')[0];
const within = (d, root) => root === '' || d === root || d.startsWith(root + '/');

/**
 * `rules` is the config's `placement`: { anchored, owned, ignore }.
 * `nodes` are fileNodes ({ f, p }), `links` are fileLinks ([from, to, ...]).
 * Returns null when the profile declares no placement.
 */
function placementOf(rules, nodes, links) {
  if (!rules) return null;
  const anchored = new Set(rules.anchored || []);
  const owned = rules.owned || {};
  const ignore = new Set(rules.ignore || []);
  const kindOf = (p) => (ignore.has(p) ? null : anchored.has(p) ? 'anchored' : owned[p] ? 'owned' : 'cohesive');
  const kinds = nodes.map((n) => kindOf(n.p));

  // Users: the files that import it. An ignored file is no user.
  const users = nodes.map(() => new Set());
  for (const [from, to] of links) {
    if (from === to || kinds[from] === null || kinds[to] === null) continue;
    users[to].add(from);
  }

  // A station's own folder: the folder it sits in, named after it, with no
  // other station beside it. `notes/domain/services/` holding several
  // services is nobody's. A station deeper inside is in someone's folder,
  // which is what `inside-station` reports. A module's root folder is never
  // a station's, though `notes/notes.service.ts` is named like it.
  const byDir = {};
  nodes.forEach((n, i) => { if (kinds[i] === 'anchored') (byDir[dirOf(n.f)] = byDir[dirOf(n.f)] || []).push(i); });
  const ownFolders = {};
  for (const [d, here] of Object.entries(byDir)) {
    if (here.length !== 1 || !d) continue;
    const s = here[0];
    if (d === nodes[s].m || !posix.basename(d).startsWith(stemOf(nodes[s].f))) continue;
    ownFolders[d] = s;
  }

  // The owner: the station whose own folder holds the file, nearest first.
  // A station's own folder does not own the station itself.
  const ownerOf = (i) => {
    for (let d = dirOf(nodes[i].f); ; d = parentOf(d)) {
      if (d in ownFolders && ownFolders[d] !== i) return ownFolders[d];
      if (!d) return null;
    }
  };

  const placement = nodes.map((n, i) => {
    if (kinds[i] === null) return null;
    const e = { kind: kinds[i], users: [...users[i]].sort((a, b) => a - b) };
    const owner = ownerOf(i);
    if (owner !== null) e.owner = owner;
    return e;
  });
  const count = (k) => kinds.filter((x) => x === k).length;
  return {
    placement,
    placementMeta: {
      kinds: { anchored: count('anchored'), owned: count('owned'), cohesive: count('cohesive') },
      ownFolders,
    },
  };
}

module.exports = { placementOf, dirOf, parentOf, stemOf, within };

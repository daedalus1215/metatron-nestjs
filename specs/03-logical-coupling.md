---
title: Logical Coupling (Co-Change Analysis)
status: draft
project: metatron-nestjs
location: specs/03-logical-coupling.md
created: 2026-08-24
tags: [analysis, git-history, coupling, lens]
---

# Logical Coupling (Co-Change Analysis)

## Context

Every graph metatron produces — folder, module, file, tier, trace — derives from
`import` statements. That is one definition of coupling, and it is structurally
blind to another: **two files with no import relationship that always change
together.**

That pattern is usually a missing abstraction, a duplicated invariant, or
shotgun surgery. It cannot be found by reading the code, only by reading its
history — and it is invisible to every lens currently shipped.

The data is already being read. `src/scan.js:522` walks
`git log --no-merges --numstat`, and at `:557` immediately discards the commit
grouping, accumulating per-file totals. The set of files in each commit — which
is exactly the co-change signal — is computed and thrown away.

Chronus has 238 commits of history against the scanned root, so the sample is
real but small; the design must not over-claim on thin data.

## Goal

Report which files change together more often than coincidence explains, and
surface where that disagrees with the import graph.

## Design

### Extraction

Keep the per-commit file set instead of discarding it. For every unordered pair
appearing in the same commit, count co-occurrences.

Two guards, both necessary:

**Commit size cap.** A 200-file rename or a formatting sweep couples everything
to everything. Ignore commits touching more than `couplingMaxFiles` files
(default **25**). Report how many commits were excluded — a corpus where half
the commits are excluded is telling you something.

**Support floor.** A pair that co-changed 2 of 2 times is 100% coupled and means
nothing. Require both files to have changed at least `couplingMinChanges` times
(default **5**) before the pair is eligible.

### Scoring

Raw counts favour files that simply change a lot, so report a **ratio**:

```
degree(a,b) = co(a,b) / (changes(a) + changes(b) - co(a,b))
```

That is Jaccard similarity over commit sets — "of all the times either changed,
what fraction were together". It is symmetric and bounded 0..1, which makes a
threshold meaningful across projects of different ages.

Also record the asymmetric pair, because it is often the more useful reading:

```
whenAchangesBalsoChanges = co(a,b) / changes(a)
```

A repository that always drags its entity along is a different story from an
entity that is dragged along by six unrelated repositories.

### The finding that matters

Coupling that *agrees* with the import graph is unremarkable — of course a file
changes with the thing it imports. The signal is **coupling without an import
edge**, in either direction, and ideally across module boundaries.

```js
{
  id: 'logical-coupling', tone: 'note',
  title: 'Files that change together but do not reference each other',
  detail: 'Across 238 commits, N pairs co-change above 60% with no import edge
           between them. Usually a duplicated rule or a missing abstraction.',
  items: ['notes/.../a.ts  ~  time-tracks/.../b.ts   (14 of 19, 74%)']
}
```

### Lens: `templates/coupling.html`

Co-change is **pairwise**, and every existing lens is node-centric (scatter,
tower, plane) or hierarchical (atlas). A pair cannot be drawn as a point, which
is why this earns its own lens rather than a panel inside `hotspots`.

Form: a **dependency structure matrix** — files on both axes, ordered by module
so blocks are visible, cell shaded by coupling degree. A DSM shows the global
structure a chord diagram hides, and off-diagonal blocks are precisely the
cross-module coupling worth finding.

Readability is the real risk: 390 files is a 152,100-cell matrix. Mitigations,
in order of importance:

1. **Only eligible files appear.** After the support floor, the axis is files
   that changed ≥5 times — on Chronus that is a fraction of 390, not 390.
2. **Threshold slider** on coupling degree, default 0.3, redrawn live.
3. **Module grouping toggle** — collapse to a module × module matrix, which is
   always small and readable, and expand one module at a time.
4. **Import overlay toggle** — mark cells that also have an import edge, so the
   unexplained ones stand out. This is the whole point of the lens and should be
   on by default.

If, once built, the file-level matrix proves unreadable on a real project, the
module-level matrix is the primary view and file level is drill-down. That
decision is deferred to the screenshot, not made now.

### Config

| key | default | meaning |
|---|---|---|
| `couplingMaxFiles` | `25` | ignore commits touching more than this |
| `couplingMinChanges` | `5` | support floor per file |
| `couplingMinDegree` | `0.3` | floor for inclusion in the model |

`churnSince` already bounds the window and applies unchanged.

## Model changes

```js
coupling: {
  pairs: [{ a, b, co, changesA, changesB, degree, aThenB, bThenA, imports: 0|1 }],
  meta: { commits, excludedCommits, eligibleFiles, maxFiles, minChanges }
}
```

Empty with a populated `meta.reason` when `churnMeta.available` is false, the
same way churn already degrades.

## Honesty constraints

The lens must state, in a `data-narr` slot rather than typed prose:

- Commits are a proxy for change, and one team's commit granularity is not
  another's. A squash-merge workflow and a commit-per-thought workflow produce
  different numbers from identical work.
- Co-change is **correlation**. Two files touched by the same sweeping rename
  are not coupled in any meaningful sense, which is what the size cap exists to
  blunt — imperfectly.
- Absence of coupling is not evidence of independence; it may just be young code.

## Out of scope

- Author-based coupling (files touched by the same person) — a different and
  more socially fraught analysis.
- Coupling across the git boundary into the frontend.

## Acceptance

- Chronus produces a non-empty `coupling.pairs` with plausible top pairs, and
  the excluded-commit count is a small minority of 238.
- At least one reported pair has `imports: 0` and crosses a module boundary, or
  the finding correctly reports that none do.
- Deleting `.git` degrades to the same message churn already produces.
- Screenshot-verified at both module and file granularity before it ships.

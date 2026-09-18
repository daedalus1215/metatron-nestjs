---
title: Logical Coupling (Co-Change Analysis)
status: draft
project: metatron-nestjs
location: docs/specs/03-logical-coupling.md
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

## Implementation notes (2026-09-17)

Landed in `src/defaults/nestjs.js` (the three `coupling*` keys), `src/scan.js`
(per-commit file sets instead of the discarded churn grouping, the size cap
and support floor, Jaccard scoring, the crossing against the import graph,
the `logical-coupling` finding, the model field), `src/narrate.js` (the
`N.coupling` slot), `adapters/coupling.js` (pairs plus the minimum of graph
the lens reads: file modules and module-level import edges),
`templates/coupling.html` (the DSM lens), and `test/coupling.test.js` with
`test/fixtures/coupling/`.

**Re-measured on the real projects, 2026-09-17.** The tree has moved since
the spec was written: chronus now has 256 commits against the spec's 238, and
12 of them (4.7%) are ignored by the size cap — a small minority, as the
acceptance criterion asks.

| project | commits | ignored | eligible | pairs | unexplained |
|---|---|---|---|---|---|
| chronus | 256 | 12 | 43 | 26 | 6 |
| nous | 70 | 1 | 6 | 1 | 0 |
| cereberus | 41 | 2 | 9 | 6 | 3 |
| omega | 36 | 2 | 1 | 0 | 0 |
| kairos | 13 | 2 | 1 | 0 | 0 |
| vereveil | 8 | 3 | 0 | 0 | 0 |

Chronus's strongest unexplained pair is
`notes/test-utils.ts ~ notes/test-utils/mock-factories.ts` (63%); its only
cross-module unexplained pair is
`check-items/.../check-items.repository.ts ~ notes/domain/services/note.service.ts`
(30%), which the module matrix shows as the off-diagonal block. Cereberus
reports `add-password ~ update-password.transaction.script.ts` at 78% — the
duplicated-rule shape the lens exists to find: two transaction scripts in one
module that share no import edge. Kairos, omega and vereveil are too young to
form pairs (one, one and zero eligible files): the lens shows its
"nothing to pair yet" state and the finding reports none — the
absence-of-coupling caveat in the narrated slot exists precisely for this.

**Deviations from the spec:**

- The finding's 60% bar is fixed reporting shorthand, distinct from the model's
  `couplingMinDegree` (0.3): the model keeps every pair at or above the floor
  for the lens, the finding shortlists the ones that are hard to explain. The
  spec's example made the bar explicit without naming a config key for it.
- Support is counted over the trusted (non-ignored) commits only: a file
  dragged along by an ignored sweep does not earn pair eligibility.
- `meta.minDegree` is stored in the model so the lens slider opens at the
  floor that was actually used.

**Lens.** The DSM defaults to the module matrix (chronus: ten modules, always
readable), with a files toggle (43 axes), click-to-zoom on blocks, a threshold
slider that opens at `couplingMinDegree`, and the import overlay on by
default — rose for unexplained, blue for explained. Screenshot-verified in
both themes, at both granularities, plus the zoom and slider states.

`npm test` runs 49 tests; 6 are new, over `test/fixtures/coupling/` with a
synthetic 26-commit git history that makes each guard fire exactly once (the
sweep exclusion, the support floor, the degree floor, the import crossing,
degradation, and the `couplingMaxFiles` override). The exact-value Jaccard
assertions double as the sweep check: if the ignored commit were counted, the
headline pair would read 0.75 instead of 5/7.

Scanned all six projects with this branch and with `main` in a worktree:
every part of the model outside `coupling` and the new finding is
byte-identical. Headless Chromium logs no console errors on any view.

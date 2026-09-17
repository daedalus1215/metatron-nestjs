---
title: Blast Radius (`metatron diff`)
status: draft
project: metatron-nestjs
location: specs/04-blast-radius.md
created: 2026-08-24
tags: [ci, pr-review, impact-analysis, reachability]
---

# Blast Radius (`metatron diff`)

## Context

The original idea was "point metatron at a PR and render just those veins" — a
filtered subgraph of the touched files. That is scoping, not analysis: a
filtered view of the same model answers the same questions in a smaller frame,
and is only as trustworthy as the model beneath it.

The version worth building answers a question none of the lenses can:

> This change touches 3 files. 14 endpoints route through them. It adds 1 layer
> skip and removes 2. Two touched files are top-10 hotspots and neither has a
> test.

That is impact analysis, and it needs the baseline from spec 02 to say
"adds" rather than merely "has".

## Goal

Given a set of changed files, report what depends on them, which endpoints they
serve, and how the change moves the architecture relative to its baseline.

## Design

### Input: git ranges only

```bash
metatron diff main...HEAD        # explicit range
metatron diff                    # defaults to <merge-base with default branch>...HEAD
metatron diff --staged           # what is about to be committed
```

Change set comes from `git diff --name-only <range>`, filtered to files inside
the scanned root.

No GitHub dependency. A range works on any local branch, offline, against
GitLab, Gitea or a bare remote, and does not require a PR to exist yet — which
is when the answer is most useful. Resolving a PR number to a range is a
one-line shell alias for anyone who wants it (`gh pr view N --json baseRefName`)
and does not belong inside the tool.

### Analysis

**1. Reverse reachability.** Invert `fileLinks` and walk outward from the change
set. Report depth, because depth 1 and depth 5 are different risks:

```
directly imported by      6 files
transitively reachable   41 files  (of 390)
```

**2. Endpoints affected.** An endpoint is affected if any changed file appears
in its `flat` trace, or is the endpoint's own file. This is the strongest signal
in the report because it is call-based, not import-based — it says which HTTP
surface actually executes the changed code.

**3. Violation delta.** Scan the working tree, compare fingerprints against
`arch.baseline.json`, and attribute each new violation to whether it involves a
changed file. A new violation in untouched code is a scan difference and should
be labelled as such, not blamed on the diff.

**4. Risk crossings.** For each changed file, report its hotspot rank, its
co-change partners not present in the diff (spec 03), and whether it has a test
(spec 06). The co-change one is the highest-value line in the report: *"you
changed `a.ts`; it has changed with `b.ts` in 14 of the last 19 commits, and
`b.ts` is not in this diff."*

### Output

Default is a terminal report. `--format=markdown` emits something pasteable into
a PR description or a CI comment. `--json` for tooling.

```markdown
### metatron · 3 files changed

**Blast radius** — 6 direct dependents, 41 transitively reachable (10.5% of the tree)

**Endpoints affected** — 14
`POST /notes` · `PATCH /notes/:id` · `GET /notes/detail/:id` … (11 more)

**Architecture** — +1 / −2 vs baseline
- new  `action>repository`  time-tracks/.../log-time.action.ts → time-track.repository.ts
- fixed `no-same-level`     notes/domain/services/note.service.ts → ...

**Worth a look**
- `note-memo-tag.repository.ts` is hotspot #1 (29 commits, 19 dependents)
- `note.entity.ts` co-changes with `note.repository.ts` 74% of the time — not in this diff
- 2 of 3 changed files have no test
```

Nothing here is posted anywhere. metatron writes to stdout; a CI step decides
what to do with it. Keeping publication out of the tool keeps it portable and
keeps it from needing credentials.

### Handling deleted and renamed files

A deleted file has no node in the current model — its blast radius is computed
from the **baseline scan**, not the current one, or it silently reports zero
impact, which is the most dangerous possible wrong answer. `metatron diff`
therefore scans twice: once at the merge base, once at `HEAD`. This roughly
doubles runtime and is worth it. Base-side content is resolved with
`git cat-file --batch` into an in-memory file map — never by checking out or
stashing, so the working tree is never touched and the command is safe to run
mid-edit.

**This is the hard part of the spec and should be built first**, because if
base-side scanning is not solved, deletions and renames make the report
untrustworthy in exactly the cases people care about.

## Dependencies

- **Spec 01** — mis-bound handlers would fabricate endpoint impact.
- **Spec 02** — the violation delta is meaningless without a baseline.
- Specs 03 and 06 are optional enrichment; the report degrades gracefully
  without them.

## Out of scope

- Rendering a filtered lens. If it is wanted later it is a query parameter on
  the existing lenses (`?focus=<files>`), not a new template.
- Posting comments to any forge.
- Blame or authorship.

## Acceptance

- `metatron diff HEAD~1...HEAD` on a known Chronus commit reports an endpoint
  set that matches manual tracing.
- A commit that deletes a depended-on file reports non-zero blast radius.
- A pure-rename commit reports near-zero impact and does not report the rename
  as a new violation plus a fixed one in the *diff* report, even though the
  baseline fingerprints legitimately change.
- Runs with no network access.

## Implementation notes (2026-09-17)

Landed in `src/diff.js` (new: the change set, the base-side scan, reverse
reachability, the endpoint and risk crossings, the violation delta with
rename folding, and the three renderers), `bin/metatron.js` (the `diff`
command, `--staged`/`--format`/`--json`, help text), `src/scan.js` (two
additions only: `opts.files` accepts a pre-read `{ relPath: content }` map so
the base-side scan runs against git objects, and `opts.churnAt` bounds the
base-side churn to that commit), and `test/diff.test.js` with
`test/fixtures/diff/`.

**Acceptance, on the real projects, 2026-09-17:**

| project | commit | files | direct | transitive | affected | removed |
|---|---|---|---|---|---|---|
| chronus | `acf6126` checklist search | 6 | 24 | 51 (14.1% of 362) | 18 | 0 |
| nous | `80c3a44` deletes `database.service` | 4 | 12 | 45 (31.7%) | 4 | 0 |
| nous | `b3a64c7` renames + deletes controller | 7 | 1 | 2 (1.4%) | 4 | 1 |
| nous | `4480ecc` deletes `email.controller` | 8 | — | — | 5 | 5 |

- Chronus's 18 affected endpoints were traced by hand: the seven check-items
  routes go action → transaction script → repository directly (the scripts
  import the repository, not the aggregator), and `GET /notes/search` walks
  `note.service.search()` into both `searchNotesTransactionScript` and
  `checkItemsAggregator` — the reported `via` lists match. The blast numbers
  match an independent reverse BFS over `fileLinks`.
- The deletion commit's blast is non-zero entirely from the base-side scan:
  the deleted service's importers (`email.repository`,
  `sender-rule.repository`, …) exist only in the base tree.
- The rename commit reports 1.4% of the tree — near-zero, as the acceptance
  asks — and the deleted controller's endpoint appears under removed, not the
  renamed service's fingerprints under added/fixed.
- The controller deletion names all five of its routes as removed; checked
  against the decorators in the file at the base commit.

`npm test` runs 58 tests, 8 of them new, over the fixture's synthetic git
history: one-file range, deletion, pure rename (asserts `folded === 2`,
`added === 0`, `fixed === 0`), action deletion, staged isolation, default
range, scan-difference labelling, outside-a-repository failure, and CLI
rendering in all three formats.

Scanned nous and chronus with this branch and with `main` in a worktree: the
models are byte-identical outside `generatedAt`, so the `scan.js` additions
are inert on the ordinary path. All six local projects run a `diff` on a real
commit without error.

**Deviations from the spec:**

- The change set is filtered with a repo-root pathspec and paths are reported
  relative to the *scanned root*, so they join the model's keys directly.
  The base-side `git ls-tree` applies the same prefix, which is where a naive
  implementation silently drops every file (and reports zero blast) whenever
  the config sits below the repository root.
- Without `arch.baseline.json` there is no delta to compute; the report lists
  the current violations that touch changed files and says "no delta", which
  is the graceful degradation the dependencies section allows. Rename folding
  applies only in baseline mode — with no baseline there is nothing to fold
  against, and the renamed file's moved violations simply appear as current
  violations touching the change.
- Affected endpoints name their `via` files (which changed files the traced
  path runs through); the spec's example showed only the endpoint list.
- A rename's churn identity survives in the current model — `scan` credits
  `git log`'s `old => new` entries to the new path — so a moved file keeps its
  hotspot rank on the current side and the base side only sees files that
  truly left.

**Known limit inherited from the trace engine.** Affected endpoints follow
`endpoints[].flat`, and the tracer reads method declarations, not
arrow-function properties. Where a service declares its methods as arrow
properties (Kairos's `MeetingService`), traces stop at the constructor, so
the endpoint list is understated for that code; the blast radius is
import-based and is not affected.

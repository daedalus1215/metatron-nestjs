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

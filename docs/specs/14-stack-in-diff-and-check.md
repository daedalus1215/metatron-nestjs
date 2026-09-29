---
title: The stack in diff, and broken calls in check
status: implemented
project: metatron-nestjs
location: docs/specs/14-stack-in-diff-and-check.md
created: 2026-09-29
tags: [diff, check, gate, bridge, full-stack]
implemented: 2026-09-29
---

# The stack in `diff`, and broken calls in `check`

## Context

Spec 13 finds what a change does across the stack: endpoints added and
removed, the HTTP pairs by class, and **broken calls**. A broken call is a
frontend call that reaches no endpoint, either because the change added it
into nothing or because it cut the endpoint away. On chronus #155 it names
three.

That lives only in the workbench, where someone has to open it. The places a
PR is actually looked at are the text report (`metatron-nest diff`, pasted
into a PR description) and CI (`metatron-nest check`, the gate). #155's three
calls passed both. #156 fixed them a PR later.

## Goal

- `metatron-nest diff`, run in a frontend linked to a backend in the same
  repository, prints the stack section.
- `metatron-nest check` fails when a frontend call reaches no endpoint and
  the baseline does not already accept it.

## Design

### Broken calls are violations

When the bridge runs, the frontend model gains a finding, `http-broken`
(tone `warn` when there is any), with one instance per call that is
`unmatched` or `ambiguous`:

```js
{ from: 'pages/ExplorerPage/hooks/useCheckItemsForMerge.ts', to: 'GET /check-items' }
```

The fingerprint is `rule|file|VERB url`, so a call that moves down its file
keeps its identity. The rest follows from spec 02 unchanged:

- `metatron-nest baseline` records today's broken calls as accepted
- `check` fails on a new one
- `diff` lists it under architecture as a new violation, attributed to the
  diff when its file is in the change

An `unread` URL is not a violation. The bridge cannot say it is broken,
and a gate on "cannot read" gets switched off.

### The stack section of `diff`

In a frontend whose linked backend shares its repository, `analyze` reads
the backend at both ends of the range, the same way it already reads the
frontend:

- from the range's base and head commits
- or the index, with `--staged`

It bridges each end of the frontend to the backend of that end, and runs
spec 13's `stackCompare`. The report gains `stack`:

```
across the stack (../backend)
  3 broken calls  !
    GET /check-items   pages/ExplorerPage/hooks/useCheckItemsForMerge.ts:16   new, reaches no endpoint
    …
  endpoints added: 1
    POST /notes/merge   ← api/requests/notes.requests.ts
  endpoints removed: none
  http: 1 graft
```

- **Broken calls come first**, above the blast radius, since they are the
  most likely reason the report is being read.
- The markdown form is the same, as a list, for a PR description.
- `--json` carries `stack` whole.

A backend in another repository gives
`stack: { backendAt: 'current' }` and one line saying the stack was not
compared, rather than a comparison against the wrong backend.

`diff` stays a report, as spec 04 made it: it exits 0. The gate is `check`.

## Acceptance

1. On chronus #155, `metatron-nest diff 9162181^1...9162181^2` in the
   frontend prints the 3 broken calls and `POST /notes/merge` with its caller.
   On #156 it prints no broken call.
2. On the fixture frontend, `check` with an empty baseline fails on its broken
   calls (an unmatched URL and an ambiguous one), and passes once
   `baseline` has accepted them. A new broken call then fails it again.
3. The backend models of chronus and omega are unchanged. `http-broken`
   exists only when a bridge runs.
4. `diff` on a backend, and on a frontend with no backend, is unchanged.

## Results (2026-09-29)

- **chronus #155:** `diff` opens with the 3 broken calls
  (`useCheckItemsForMerge.ts:16`, `useNoteTagsForMerge.ts:13`,
  `useTimeTracksForMerge.ts:14`) and `POST /notes/merge ←
  notes.requests.ts`. The same three are listed under architecture as
  `http-broken` violations in the diff.
- **chronus #156:** no broken calls, and 3 rewires.
- **Fixture frontend:** `baseline` accepts its two broken calls (the
  unmatched one and the ambiguous one), and `check` passes. A new call to
  `/ghosts` fails `check` by name. `baseline --update` accepts it again.
- **A backend-only change seen from the frontend:** "no files changed in the
  scanned root", then the broken call it caused, with the endpoint it used to
  reach.
- **The backend models** of chronus and omega are identical before and
  after, checked against a worktree of `main`.

**Found on the way:**

- `stackOf` was never exported from `change.js`, so `diff` failed on the
  first real run.
- The markdown folded a paragraph into the preceding list item. Each group
  is its own paragraph now.

The chronus run used the settings of chronus's committed
`frontend/arch.config.cjs`. That file is on the `action-ts-law-of-demeter`
branch, not yet on its `main`.

## Out of scope

- **`diff` or `check` run from the backend directory.** The backend config
  does not know its frontend, so run them from the frontend, where both
  sides are in view.

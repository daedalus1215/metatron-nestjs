---
title: Change Overlay — a PR on the workbench
status: implemented
project: metatron-nestjs
location: docs/specs/11-change-overlay.md
created: 2026-09-26
tags: [lens, workbench, diff, wiring, git]
implemented: 2026-09-26
---

# Change Overlay — a PR on the workbench

## Context

`metatron diff` (spec 04) says what a change *reaches*: the files that
import the changed ones, and the endpoints whose traces pass through them.
It is a text report built on imports and traces.

It cannot say what a change *is*, structurally:

- Does it add a new corner of the codebase that plugs in at one place, or
  does it rewire the old one?
- Which existing classes does the new code lean on?
- Which existing classes were changed to reach the new code?
- Which methods were edited without the wiring moving at all?

Spec 09 made those questions answerable. A brick has a stable id and line
ranges; wires and calls are edges between ids. Scan the base and the head
of a change, compare the two wiring models, and every brick and edge falls
into a class. Spec 10 has the bench to paint them on.

## Goal

Open the workbench on a git range, a PR, or the work in progress. It shows
the change as a picture:

- a **change map**: only the bricks the change involves, in tier rows
- each brick and connection coloured by what the change did to it
- a **summary** that names where the new code meets the old
- for a range of several commits, a **scrubber** that replays it commit by
  commit

## Design

### What is compared

Two wiring models: the **base** and the **head**.

| input | base | head |
|---|---|---|
| nothing (work in progress) | merge base of the default branch and `HEAD` | the working tree |
| `range=A...B` | merge base of A and B | commit B, read from git objects |
| `pr=N` | the PR's base commit | the PR's head commit |

The head of a range is **read from git objects**, not from the working tree.
`metatron diff main...feature` scans the working tree as its head even when
`feature` is not checked out. The overlay must not repeat that: a PR
reviewed from `main` should show the PR.

**PRs.** `pr=N` asks `gh pr view N --json baseRefOid,headRefOid,title`.
That is the one network call, and it happens only when a PR is asked for.
If the head commit is not in the local object store, the overlay does not
fetch it, because fetching writes to the user's repository. It says so:

```
the PR's head commit a1b2c3d is not in this repository.
  git fetch origin pull/N/head
```

Both scans reuse `baseFileMap` from `diff.js`: `ls-tree` plus one
`cat-file --batch`, with nothing checked out. Scans are cached by commit
sha, keeping the last 8, so moving the scrubber back and forth does not
re-scan.

### Classifying bricks and studs

A brick is matched across the two models by id. A file rename (`git diff
-M`) rewrites the base ids first, so a moved class is `edited` or
`unchanged`, not removed plus added.

| brick | meaning |
|---|---|
| `added` | only in the head |
| `removed` | only in the base |
| `edited` | in both, and its text differs |
| `unchanged` | in both, same text |

Text is compared line range against line range, from the two scans' own
text maps, with trailing whitespace ignored. No hunk parsing is needed, and
a brick that merely moved down a file because something above it grew
stays `unchanged`.

Studs and internals are compared by name inside an edited brick, the same
way (`added`, `removed`, `edited`, `unchanged`). A brick can be `edited`
while every stud is unchanged: the constructor, a field, or a decorator
changed. The overlay says so, rather than inventing a stud to blame.

### Classifying connections: new veins

Wires and calls are reduced to brick pairs. A pair connects two bricks if
any wire or call joins them. Each pair present in the head and not in the
base is classified by which of its two ends already existed:

| from → to | class | reads as |
|---|---|---|
| new → new | `territory` | new code talking to itself |
| new → existing | `attachment` | new code plugging into the old |
| existing → new | `graft` | old code changed to reach the new |
| existing → existing | `rewire` | the old code's shape changed |

A pair in the base and not the head is `detached`. For a pair in both,
new calls between them, keyed by `fromMethod → toMethod`, are listed
under it. They are the same pair gripping a new stud.

**The summary leads with where the change meets the codebase:**

```
12 new bricks · 4 edited · 1 removed
attaches to 5 existing bricks   NoteAggregator (3 calls), NoteRepository, …
grafted into 2                  NoteService now reaches ExportNotesTS, …
rewires 1                       CheckItemsService → TimeTrackAggregator
```

`attachment` and `graft` are the new veins. A change with many
attachments and no grafts or rewires is additive: new code leaning on the
old. Grafts and rewires are where existing behaviour moved.

### Frames

For a range of several commits, frame *k* compares the base with commit
*k*'s tree. Frame 0 is the base, and the last frame is the head. Commits
come from `git rev-list --reverse --first-parent base..head`, so a merge
from the base branch into the PR is one frame, not a replay of main.

A commit set that is not a contiguous range (a cherry-picked handful) is
out of scope. Per-commit overlays would each need their own base, and a
summary of the set would need its own definition.

### The page

- **A "change" field** in the bar takes a range or `#N`, or is empty for
  work in progress. The change lives in the hash (`#change=main...feat/x`,
  `#change=pr:12`), alongside `b=`.
- **In change mode, the bench shows the change map.** Its neighbourhood is
  every added or edited brick, plus both ends of every classified pair.
  Unchanged bricks appear only as context at the end of an edge, drawn
  plain. Focusing a brick still works as before, painted.
- **Colours:**
  - `added` bricks are tinted green, and `edited` ones amber
  - edges are coloured by class, with `attachment` and `graft` the loudest
  - a stud pip is outlined by its own status
- **Removed bricks** are drawn as ghosts, dashed and struck through, as
  they were at the base. `removed` carries each whole brick, and detached
  connections are dashed red. Their source is served at the base commit.
  *(Added 2026-09-27; first cut listed them only.)*
- **The left column gains a change panel**, built from the summary:
  attachments grouped by the existing brick they land on, grafts, rewires,
  and edited bricks with their edited studs. Every row focuses a brick.
- **The scrubber** appears when there is more than one commit. Each frame
  shows its commit subject.
- **The source panel** shows the head's text, served from the change's own
  text map (`/api/source?file=&rev=<sha>`, answered only for a head this
  server scanned).

### API

| route | returns |
|---|---|
| `GET /api/change?range=A...B` · `?pr=N` · (none) · `&frame=k` | the head payload (as `/api/model`), plus `change`: `{ label, base, head, frames, frame, bricks: {id: status}, studs: {id: {name: status}}, pairs: [...], removed: [...], summary }` |

### `metatron diff` points here

The terminal report's last line gains the workbench URL for the same range
(`http://127.0.0.1:4477/#change=<range>`) when a workbench is listening on
the default port. Otherwise it gives the command to start one.

## Acceptance

1. **`compare(base, head)` is pure**, and is tested on in-memory file maps
   (`scan`'s `opts.files`) with no git involved. The tests cover:
   - an added brick attaching to an existing one
   - an existing brick grafted to reach a new one
   - a rewire between two existing bricks
   - a detached pair
   - an edited stud
   - a brick that only moved down its file (`unchanged`)
   - a renamed file (`edited` or `unchanged`, never removed plus added)
2. **A git integration test** builds a temporary repository with three
   commits. It checks the range's frames, that the head comes from the
   commit rather than the working tree, and the refusal when a PR head
   commit is missing.
3. **On chronus**, a recent merged PR's range renders its change map with
   no console errors. The summary's attachment targets are the existing
   bricks its new classes inject.

## Results (2026-09-26)

On chronus's own merged PRs (`<merge>^1...<merge>^2`), about 0.4 s each:

| PR | what the overlay says |
|---|---|
| #167 register user | one new `RegisterUserTransactionScript`: it attaches to the existing `UserRepository`, and `UsersService` is grafted to reach it |
| #177 layout unification | one new `CreateNoteResponder`, grafted into `CreateNoteAction`. The 55 moved files are renames, so nothing reads as removed |
| #178 remaining modules | a service layer inserted: the new `FolderService` is grafted under six folder actions and attaches to six existing folder transaction scripts; the tag and time-track actions are rewired through their services. 15 frames |
| #166, #171 | bodies edited, no wiring moved, and the overlay says so |

In headless Chromium on #178, the change map draws 29 bricks, with 7
attachments, 7 grafts and 9 rewires. Focusing the new `FolderService`
shows its source at the head. Scrubbing to frame 3, a move-only commit,
shows that nothing moved.

**A bug the real repository found and the fixture did not.** Rename
detection ran `git diff -- backend/src` from `backend/`. Git pathspecs are
relative to the repository root, so it matched nothing, and #177 read as 35
added and 34 removed. Every pathspec command now runs from the repository
root, and the test repository keeps its config in `backend/`.

**Resolved later (2026-09-27):** `metatron diff <A>...<B>` scanned the
working tree as its head, so on a branch that was not checked out it
disagreed with the overlay. `diff` now reads its head from git too. See the
amendment at the end of spec 04.

## Out of scope

- **Commit sets that are not a range.** See Frames.
- **Posting anything to a PR.** The overlay reads.

## Follow-up (2026-09-27): removed bricks on the bench

The head model has no removed brick, so the first cut listed removed
bricks and drew nothing. Now:

- `compare()` puts the **whole base brick** in `removed`: studs, sockets,
  internals and lines.
- The page adds each one as a **ghost**, dashed and struck through, linked
  by the pairs the change detached. The change map includes the ghosts and
  both ends of every detached pair.
- **Detached pairs** are drawn dashed red, straight from `pairs`, since the
  head has no wire or call left to draw them from.
- **The server keeps the base's text** as well as the head's, so a ghost's
  source panel shows the file as it was (`/api/source?rev=<base>`).

On chronus #178 the map draws 2 of its 4 removed bricks (the other two are
DTOs, hidden by default), and 15 detached edges. `CreateTagAction` is one of
the two: it was deleted in `b14b886`, *"drop the never-registered
create-tag"*. Clicking it shows its source at the base and its three severed
connections. `test/change-git.test.js` covers the whole-brick payload and
the base-side source.

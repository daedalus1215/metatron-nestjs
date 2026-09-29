---
title: Stack Change — a PR across the frontend and the backend
status: draft
project: metatron-nestjs
location: docs/specs/13-stack-change.md
created: 2026-09-29
tags: [lens, workbench, change, full-stack, bridge]
---

# Stack Change — a PR across the frontend and the backend

## Context

Spec 11 made a change something you can see: every brick added, edited or
removed, and every new connection classed by which of its ends already
existed (attachment, graft, rewire, territory). Spec 12 joined a React
frontend to its NestJS backend on one workbench, with each HTTP call an edge
into the endpoint it reaches.

The two do not meet yet. Change mode on a joined workbench compares only the
frontend. The backend is drawn as it is today, whatever commit is being
reviewed, and the HTTP edges are matched against today's endpoints. A PR
that adds an endpoint and the page that calls it reads as a frontend change
calling something that was always there.

Chronus keeps both halves in one repository, and its PRs cross the line
often. Of its last 40 merges, 12 touch both `frontend/src` and
`backend/src`.

**Measured on chronus's PRs (2026-09-29).** Both sides were scanned at each
PR's base and head, and each frontend was bridged to the backend of the
same commit:

| PR | endpoints | HTTP calls |
|---|---|---|
| #155 merge-notes | `POST /notes/merge` added | its caller added; **3 new calls match no endpoint**: `GET /check-items`, `GET /note-tags`, `GET /time-tracks` from new merge hooks. 64 calls, 61 matched |
| #156 merge-notes (the follow-up) | none | the 3 now reach real endpoints: 64/64 |
| #143 audio-delete | `PATCH /notes/:id/convert-to-memo` added | its caller added |
| #157 time-track-page | `GET /time-tracks/date-range` added | its caller added |
| #166 memo-move-folder | none | none: 12 frontend and 6 backend files edited, no connection moved |

\#155 shipped three frontend calls into nothing, and the next PR repaired
them. A stack-level review of #155 would have named all three.

## Goal

Change mode on a joined workbench compares **both sides at both ends** of
the change. It answers the questions a full-stack PR raises:

- which endpoints did it add, and does anything call them yet?
- which did it remove, and does anything still call them?
- which frontend calls did it add, and do they reach anything?
- is a new feature a new vein all the way through: a new page calling a new
  endpoint served by a new transaction script?

## Design

### Both sides, at the same commit

When the frontend's `backend` is in the same git repository, every frame
reads both trees from that frame's commit:

- The backend is scanned from git objects, like the frontend.
- The frontend is bridged to the backend **of the same commit**, not to
  today's.
- `scan` accepts `opts.backend`, an already-scanned backend model, instead
  of loading the linked one. Both sides are cached per commit.
- For work in progress, both sides are the working tree.

When the backend lives in another repository, only the frontend has
history. The backend side is drawn as it is now, and the change says so
(`backendAt: 'current'`). It does not guess which backend commit the
frontend commit ran against.

### Two compares and one bridge compare

- **Each side is compared as in spec 11:** `compare(base, head, renames)`,
  with renames read from the side's own root. The results are merged under
  `fe:` and `be:`, as the joined workbench keys bricks.
- **The HTTP edges are compared on their own.** Each matched call is a pair:
  the frontend brick making it, and the backend brick owning the endpoint.
  A pair in the head and not the base is classed by which ends already
  existed, as spec 11 classes any pair:

| fe → be | class | reads as |
|---|---|---|
| new → existing | `attachment` | new frontend code uses the existing API |
| existing → new | `graft` | existing frontend code reaches a new endpoint (a new call in an old request module) |
| existing → existing | `rewire` | existing code now reaches a different existing endpoint |
| new → new | `territory` | a new vein through the stack: new frontend code calling a new endpoint |

A pair in the base and not the head is `detached`.

### Endpoints and broken calls

Endpoints are compared by id (`VERB /route#handler`):

- **Added**, with the head's frontend calls that reach them. An added
  endpoint nothing calls is listed as such, because it may be API surface for
  another client, or not wired up yet.
- **Removed**, with the base's calls that reached them.

**A broken call** is an HTTP call in the head that matches no endpoint
(`unmatched` or `ambiguous`), and was either added by the change or matched
at the base. The first is a new call into nothing, as in #155. The second is
a call the change cut off, when its endpoint was removed or its route
changed. Each is listed with its verb, URL, file and line. An `unread` URL
is listed apart: the bridge could not read it at either end, so the change
cannot say it broke.

`summary.stack`:

```js
{ endpointsAdded:   [{ id, calledBy: [fe brick ids] }],
  endpointsRemoved: [{ id, calledBy: [fe brick ids, at the base] }],
  broken:           [{ from, verb, path, line, was: endpoint id | null }],
  http: { attachment, graft, rewire, territory, detached } }   // counts
```

### The page

- **The change map** includes both sides: every added or edited brick on
  either side, and both ends of every classed pair. HTTP pairs are coloured
  by class, like any pair.
- **The change panel leads with the stack**: endpoints added (with their
  callers, or "nothing calls it yet"), endpoints removed, and **broken
  calls, in red, first**. Then each side's attachments, grafts and rewires,
  as in spec 11.
- **The scrubber** runs over the repository's commits. Each frame compares
  both sides at that commit, so replaying #155 then #156 shows the three
  broken calls appear and then heal.

## Acceptance

1. `stackCompare()` is pure, and is tested on four in-memory models (two
   sides, two ends). The tests cover:
   - an endpoint added with a new caller (`territory`)
   - a new caller of an existing endpoint (`attachment`)
   - an old request module calling a new endpoint (`graft`)
   - a removed endpoint still called (a broken call, `was` set)
   - a new call to nothing (a broken call, `was: null`)
   - a detached pair
2. A git test on a temporary monorepo (the frontend and backend fixtures in
   one repository) checks that the backend side is read from the frame's
   commit, not the working tree.
3. On chronus #155, the change names `POST /notes/merge` as added, with its
   caller, and names the 3 broken calls. On #156 the same 3 calls are
   rewires, and nothing is broken.
4. The page draws #155's change map with both sides and no console errors.
5. Change mode on a backend alone, or on a frontend with no backend, is
   unchanged.

## Out of scope

- **A backend in another repository.** That needs a pairing of commits
  across repositories, which nothing here can know.
- **Contract changes inside an endpoint** (a DTO field renamed on one side
  and not the other). The bridge matches routes, not payloads.

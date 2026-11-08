---
title: Connect bricks — and move what a connection makes shared
status: draft
project: metatron-nestjs
location: docs/specs/18-connect-and-relocate.md
created: 2026-11-07
tags: [workbench, intent, agent, placement, editing, refactor]
---

# Connect bricks — and move what a connection makes shared

## Context

Spec 17 creates a brick. This spec changes how existing bricks connect:
connect one to another, detach a connection, or rewire one to a different
brick. The same machinery applies: a gesture becomes an intent, an agent
makes the edit, and the scan gives the verdict.

A connection is rarely just a constructor parameter, because of spec 16's
rule. **Connecting can change where a file has to live:**

- A **cohesive** file that gains a user outside its folder has to move
  up. Chronus's `UpdateNoteParamsToEntityConverter` lives in
  `update-note-TS/`. If `CreateNoteTransactionScript` starts using it, its
  home becomes `notes/domain/transaction-scripts/`. The connection and the
  move are one change: done separately, the tree is wrong in between, and a
  reviewer sees a converter used from another transaction script's folder.
- An **owned** file cannot gain a peer at all. Transaction scripts do not
  share projections, and actions do not share DTOs. Connecting
  `GetTagsByNoteIdsTransactionScript` to
  `get-tags-by-user-id.projection.ts` is refused. In its place, the bench
  offers to create the transaction script's own projection, as a spec 17
  intent.
- **Anchored** files never move. A transaction script used by a second
  service stays where its layout puts it.

Today's trees already have files whose placement is broken (spec 16
measured them): omega's converter shared by three transaction scripts, and
DTOs in by-kind folders that belong in their action's. The same move intent
fixes those, with no new connection. That is the smallest useful first step.

## Goal

On the workbench, with `serve --edit`:

- **Fix placement:** a brick whose spec 16 verdict is `cohesive-move-up`,
  `cohesive-away` or `owned-move-in` gets a **Move it** action in the
  inspector. The move updates every import of the file.
- **Connect:** drag from a brick's socket edge to another brick. Allowed
  only where spec 17's palette rules allow that pair. If the connection
  makes a cohesive file shared, the intent includes the move. If it would
  share an owned file, it is refused, with the offer to create one.
- **Detach:** drag a wire off. Refused while a call still goes through the
  socket, listing each call site with its line.
- **Rewire:** drag a wire's end from B to C. Offered only when C has every
  method called through the socket. Otherwise it is refused, naming the
  missing ones.

## Design

### Placement as a function, asked "what if?"

Spec 16's verdict becomes a pure function of the files and their users.
This spec calls it with a user added or removed, before anything is
written:

- **connect A → B:** B's users plus A. If B's verdict goes from fits to
  `cohesive-move-up`, the intent includes moving B to its new home. If it
  goes to `owned-shared`, the connection is refused.
- **detach A → B:** B's users minus A. If B now sits above its only user's
  folder (`cohesive-could-move-down`), a move is **offered**, not included.
  Moving a file down is tidying, and the gesture did not ask for it.

The ghost on the bench shows the outcome before **Make it**: the wire, and B
drawn at its new folder with an arrow from the old one.

### The intents

The same record as spec 17, with these kinds:

| kind | what the agent is asked to do | the edits |
|---|---|---|
| `move` | move a file to a folder | the file, every import of it (tests and the module too), nothing else |
| `connect` | inject or import B in A, plus a move if B becomes shared | A's constructor and imports, the module if B is newly registered, and the move |
| `detach` | remove A's dependency on B | A's constructor and imports. Refused while calls use it |
| `rewire` | replace B with C in A | A's constructor parameter, its imports, and each call through the socket |

The prompt for a move lists every file that imports the old path, from the
model's import graph, so the agent does not have to search for them. A move
of a file used by tests says so, because test utilities import it too. In
chronus, `test-utils/mock-factories.ts` imports the update-note converter.

### Refusals carry their reason and an offer

| gesture | refused when | the offer |
|---|---|---|
| connect | the pair breaks a palette rule (spec 17) | none. The rule's `why` is shown |
| connect | it would share an owned file with a peer | create A's own file of that pattern (spec 17), with the existing one shown as a starting point for its fields |
| connect | A and B are in different modules | none, until module scope is modelled |
| detach | calls go through the socket | the call sites, each linked to its line |
| rewire | C lacks a method called through the socket | the missing methods |

A refusal is never silent. The gesture snaps back, and the reason is shown
where the wire was dropped.

### The verdict

Spec 17's checks, plus:

| check | passes when |
|---|---|
| `moved` | the file is at its new path and gone from the old one |
| `imports` | no import names the old path, and `import-unresolved` gained nothing |
| `placement` | the moved file, and every file whose users the change altered, fits |
| `wire` / `unwired` | the connection exists, or no longer does |
| `calls` | (rewire) every call that went through the socket now resolves to C |

### Moves without a model, later

A move is mechanical. The project's own `typescript` package can do it
(`getEditsForFileRename` in the language service), with no model and with
certainty. Both chronus's backend and its frontend have it in
`node_modules`. This spec moves through the agent, like everything else, so
that one path is proven first. A direct move, behind the same verdict, is
the obvious follow-up.

## Increments

1. Placement as a pure function, with "what if" calls tested on fixtures.
2. `move`: the intent and its verdict, from spec 16's verdicts in the
   inspector. On omega, it moves `RecurringEventToDomainConverter` up.
3. `connect`, with the move folded in, and the owned refusal with its
   offer.
4. `detach`, with the call-site refusal.
5. `rewire`, with the missing-methods refusal.
6. The bench: drag gestures, the ghost of the outcome, refusals where the
   wire is dropped.
7. README and skill.

## Acceptance

- On omega, **Move it** on `RecurringEventToDomainConverter` yields an
  intent to move it to `calendar-events/domain/transaction-scripts/`, listing
  six imports to update: its three transaction scripts, two of their specs,
  and `calendar-events.module.ts`. The verdict on a correct result passes
  `moved`, `imports` and `placement`.
- In a fixture, connecting a second transaction script to a converter in
  the first one's folder produces one intent that connects and moves.
- In a fixture, connecting a transaction script to another one's projection
  is refused, and the offer is a spec 17 intent for its own projection.
- Detaching a socket that a method still calls through is refused, and the
  call sites are listed with their lines.
- Cross-module connections are refused with the reason.

## Out of scope

- **Cross-module connections.** These need Nest module scope: the providing
  module must export the class, and the consuming module must import that
  module. Metatron does not model either yet (Parked on the checklist). This
  is the spec that will need it.
- **Splitting an owned file** that is already shared, such as chronus's
  `note.response.dto.ts` used by five actions. Spec 16 reports it. Splitting
  means deciding which fields each action needs, which is a design decision,
  not a move.
- **Studs.** Connecting "A.execute calls B.find" means writing logic. The
  connect intent wires the dependency. The call itself is for you or the
  agent.
- **The frontend.**

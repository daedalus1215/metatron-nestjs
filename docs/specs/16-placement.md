---
title: Placement — a file lives with its users
status: draft
project: metatron-nestjs
location: docs/specs/16-placement.md
created: 2026-11-07
tags: [placement, cohesion, folders, model, violations]
---

# Placement — a file lives with its users

## Context

The folders in these backends carry a rule that no config states: **a file
lives with the code that uses it.** That is functional cohesion. A converter
that only `CreateNoteTransactionScript` uses sits in `create-note-TS/`,
beside it. Nothing checks this today. When a second transaction script
starts using that converter, the converter stays where it was, in the first
one's folder, and the folder stops telling the truth.

The rule has three kinds of file, not one:

- **Anchored files are placed by role.** Actions, services, transaction
  scripts and repositories live at a fixed level within their business
  domain, never in each other's folders, and so do aggregators, ports,
  entities, guards, listeners, gateways, caches and remote callers. The
  cross-domain commands in `shared-kernel/domain/cross-domain-commands/` are
  anchored too: they are the sanctioned way across contexts, like ports.
- **Owned files belong to one station and are never shared.** A DTO belongs
  to one action, and a projection or command to one transaction script.
  Code that points *in* at the owner may use them: the service that calls
  the transaction script, the response DTO built from its projection, the
  repository that fills it. Repositories are infrastructure and swappable,
  so they point at the domain. A **peer** of the owner may not: two actions
  do not share a DTO, and two transaction scripts do not share a projection.
  Each gets its own. Moving the file would not fix that.
- **Cohesive files are shared by moving.** Converters, mappers, assemblers
  and helpers live in the nearest folder that holds all their users. Used by
  one transaction script, that is its folder. Used by three, it is
  `transaction-scripts/`, the level above them.

**Measured with a prototype (2026-11-07)** on fresh scans of both backends,
after renaming three files to the convention (see Names, not roles, below).
Users are the files that import a file, leaving out module files
(registering a provider is wiring, not use), tests and test utilities.

| | chronus | omega |
|---|---|---|
| anchored files | 185 | 92 |
| … inside another station's folder | **0** | **0** |
| transaction scripts in one layout | 62/62 | 27/27 |
| owned files that fit | 80 | 69 |
| … shared by peers | 7 | 3 |
| … sitting in a by-kind folder, with one owner | 12 | 5 |
| … used by the domain or infrastructure (outward) | 12 | 1 |
| … with no owner among their users | 4 | 0 |
| cohesive files that fit | 12 | 10 |
| … shared, living in one consumer's folder | 0 | 1 |
| … away from all their users | 1 | 1 |

The anchored half of the rule holds without exception in both trees. The
cases the rule is for:

- **omega's `RecurringEventToDomainConverter`** lives in
  `create-recurring-event-TS/` and is used by three transaction scripts:
  `create-recurring-event`, `fetch-recurring-events` and
  `search-calendar-events`. It belongs in
  `calendar-events/domain/transaction-scripts/`.
- **chronus's `note-name-row.projection.ts` and
  `user-response.projection.ts`** are each shared by two transaction
  scripts. They sit at the `transaction-scripts/` level, which would be right
  for a converter and is wrong for a projection: each transaction script
  should have its own.
- **chronus's `get-note-by-id.responder.ts`** lives in
  `get-note-by-id-action/` and is also used by
  `convert-checklist-to-memo.action.ts`, a peer.
- **Response DTOs shared across actions:** `note.response.dto.ts` (5
  actions), `folder.response.dto.ts` (4), `tag.response.dto.ts` (3) and
  `check-item.response.dto.ts` (7 swagger files) in chronus;
  `calendar-event.response.dto.ts` (4), `calendar.response.dto.ts` (3) and
  `event-reminder.response.dto.ts` (2) in omega.
- **DTOs in a by-kind folder** such as `notes/apps/dtos/requests/`, used by
  one action: 12 in chronus, 5 in omega. Each belongs in its action's folder.
- **The domain using an action's DTO.** `TagService` and
  `UpdateTagTransactionScript` take `update-tag.dto.ts`, three transaction
  scripts build `tag.response.dto.ts`, and `hermes.remote-caller.ts` returns
  `audio.response.dto.ts`. In all, 29 imports of 16 DTO files in chronus,
  and `UsersService` taking `create-user.request.dto.ts` in omega. The
  domain points out at the apps layer. That is a direction rule rather than
  a placement one, so it goes in `forbidden` (see Outward, below).

Two things the prototype got wrong, and what the real check must do:

| trap | what the check must do |
|---|---|
| A folder holding one station was taken as that station's own, so `notes/apps/actions/` became one action's folder, and 21 actions were "inside" it. | A station's own folder is **named after it** (`create-note-TS/`, `merge-notes-action/`, `tag-repository/`) and holds no other station. |
| A response DTO built from its transaction script's projection was flagged as sharing the projection. | A **peer** is a user that belongs to another station of the owner's kind: that station itself, or a file in its own folder. Everything else outside the folder is pointing in. |

Specs 17 and 18 edit the code from the workbench. They need this first:
creating a brick means knowing where it goes, and connecting one means
knowing whether something now has to move.

## Goal

Every file in the scanned tree gets a **placement**: its kind, its owner or
home, and a verdict. Each verdict that breaks the rule is a violation,
fingerprinted like any other, so `baseline` accepts today's and `check` can
hold the line. A change that breaks the rule says so in `diff` and on the
change map. Nothing is moved. This spec only reports.

## Design

### Three kinds, from the config

The profile declares the anchored and owned patterns. Every other pattern
is cohesive.

```js
placement: {
  anchored: ['action', 'controller', 'resolver', 'service', 'transaction-script',
             'repository', 'remote-caller', 'aggregator', 'port', 'entity',
             'guard', 'listener', 'gateway', 'cache'],
  // pattern -> the station kinds that own it
  owned: {
    dto: ['action', 'controller', 'resolver'],
    swagger: ['action', 'controller', 'resolver'],
    responder: ['action', 'controller', 'resolver'],
    command: ['transaction-script'],
    projection: ['transaction-script'],
  },
},
```

A command under `cross-domain-commands/` is anchored, whatever `owned`
says. This is a separate pattern in the profile (`cross-domain-command`),
not a special case in the check.

### Names, not roles

Metatron classifies a file by its name, here as everywhere. A transaction
script's input is a `.command.ts` and its output a `.projection.ts`, whatever
the file holds. Three files that did the job under other names were renamed,
not taught to the profile:

| was | is |
|---|---|
| omega `search-calendar-events-TS/search-calendar-events.result.ts` | `search-calendar-events.projection.ts` |
| omega `fetch-calendars-TS/calendar-with-role.type.ts` | `calendar-with-role.projection.ts` |
| chronus `update-note-TS/update-note.params.ts` | `update-note.command.ts` |

Before the renames, the two omega files were unclassified, so they were
taken as cohesive and told to move up, out of their transaction script's
folder. The chronus file matched the `dto` pattern, which caught every
`.params.ts`. **The `dto` pattern drops `.params.ts`.** That file was its
only match in either tree, and it was a command.

So that the next one is caught by name, a file in a station's own folder
that matches no pattern (`other`) gets its own verdict, `unnamed`, with the
patterns the station's kind owns as the remedy: "name it as a command or a
projection, or as a converter, mapper or assembler". There are none in
either tree after the renames. An unclassified file anywhere else is
cohesive, and its verdict ends `(unclassified)`. Domain vocabulary such as
omega's `calendar-role.type.ts` in `domain/entities/` is in no station's own
folder, so it is cohesive, and it fits.

### Users

The files that import it, with type-only imports included. Left out:

- module files, because listing a provider is wiring, not use
- tests, test utilities and mock factories
- the Platform tier (`main.ts`, migrations)

### A station's own folder

The directory a station sits in, when its name starts with the station's
file stem and it holds no other station. `create-note-TS/`,
`merge-notes-action/`, `tag-repository/` and `time-track-service/` are own
folders. `notes/domain/services/` is not: it holds several services. A
station with no own folder has nothing living inside it. Its helpers sit
beside it, and the nearest-folder rule places them there.

### Anchored: the layout

Each anchored pattern's layout is learned from the tree. The path is
abstracted, with `{module}` for the first segment and `{name}` for the
file's stem wherever it appears, and the most common template is the
layout. Its share is reported, the way coverage is:

| pattern | chronus | omega |
|---|---|---|
| transaction-script | 62/62 `{module}/domain/transaction-scripts/{name}-TS/{name}.transaction.script.ts` | 27/27, the same |
| aggregator | 7/7 `{module}/domain/aggregators/{name}.aggregator.ts` | 4/4, the same |
| repository | 7/10 `{module}/infra/repositories/{name}.repository.ts` | 9/9, the same |
| service | 6/10 `{module}/domain/services/{name}.service.ts` | 5/7, the same |
| action | **31/61** `{module}/apps/actions/{name}-action/{name}.action.ts` | 22/25, the same |

A pattern whose layout covers less than 80% of its files **has no layout**,
and nothing is reported off it. In chronus, that is actions (31/61), services
(6/10) and repositories (7/10). Its actions use three layouts
(`{name}-action/`, `{name}/`, and `notes/{name}-action/`), and choosing one
would call 30 files wrong on a guess. A config can state a layout outright:

```js
layouts: { action: '{module}/apps/actions/{name}-action/{name}.action.ts' },
```

Verdicts:

- `inside-station`: an anchored file inside another station's own folder.
  The measured count is 0 in both trees, and it should stay 0.
- `off-layout`: an anchored file that does not fit its pattern's layout,
  when the pattern has one.

Spec 17 uses the layout to name and place a new brick.

### Owned: one owner, never shared

The **owner** is the station whose own folder holds the file. Outside that
folder, a user is one of three things:

- **pointing in**, which is fine. A caller above the owner, which needs its
  contract to call it. A response DTO built from a transaction script's
  projection. A repository or hydrator filling a transaction script's
  projection.
- **a peer**: it belongs to another station of the owner's kind. That
  breaks the rule.
- **outward**: the domain or infrastructure depending on an entry point's
  own file, for example a service taking an action's request DTO. That
  breaks the rule that the domain is pointed at and never points out. It is
  reported by a `forbidden` rule (Outward, below), not by a placement
  verdict.

Verdicts:

| verdict | when | remedy, as stated in the finding |
|---|---|---|
| `owned-shared` | a peer uses it, or it sits in a by-kind folder and two or more owners use it | each peer gets its own |
| `owned-move-in` | it sits in a by-kind folder (`apps/dtos/requests/`) and exactly one owner uses it | move it into that owner's folder |
| `owned-orphan` | none of its users is of its owner's kind (a projection only a service reads) | none proposed; it is listed |
| `unnamed` | it is in a station's own folder and matches no pattern | name it as one of the patterns its owner's kind owns, or as a cohesive one |

### Outward: the domain never depends on an entry point's contract

The nestjs profile gains one `forbidden` rule:

```js
{ from: ['service', 'aggregator', 'transaction-script', 'repository',
         'hydrator', 'remote-caller', 'cache', 'entity', 'port'],
  to: ['dto', 'responder', 'swagger'],
  why: "The domain depends on an entry point's contract, pointing out at the apps layer" },
```

`from` and `to` accept a list, which is new. A string still works. The
rule is a `forbidden` rule rather than a placement verdict so that `check`
enforces it the way it enforces the upward rules, and so that spec 17's
palette greys out "DTO below a service" with this `why`. The Contract tier
sits above the domain, so these are reported with the upward calls.

Commands are not in `to`. A service builds its transaction script's
command, and that points in.

The remedy, stated in the finding, depends on the direction of the DTO:

- **A request DTO taken by the domain:** the action turns it into the
  transaction script's command, or into the service's arguments.
- **A response DTO built by the domain:** the transaction script returns its
  projection, and the action's responder builds the DTO from it.
- **A response DTO returned by a remote caller:** the caller returns a domain
  type, and the action maps it.

Measured: 29 imports of 16 DTO files in chronus, and 1 in omega. Before
`update-note.params.ts` was renamed, it was a 30th, and a false positive
(Names, not roles).

Adding the rule to the profile adds those imports to the next `check` as
new violations. `baseline --update` accepts them, as with any new rule.

### Cohesive: the nearest folder holding all its users

The **home** is the deepest folder that contains every user. Verdicts:

| verdict | when |
|---|---|
| fits | it lives at its home, or below it, and not inside a station's own folder that some user is outside of |
| `cohesive-move-up` | it lives in one station's own folder, and a user outside that folder uses it. This is the case the rule exists for: the file "lived with the first transaction script" |
| `cohesive-away` | it lives neither at, above nor below its home: `shared-kernel/utils/date.utils.ts`, used only by chronus's time-track repository |
| `cohesive-could-move-down` | it lives above its home. Advisory only, and never a violation. It measured 0 in both trees |

A home at the module root means the users span tiers. That has not happened
for a cohesive file in either tree, because every cross-tier case was an
owned file. It is reported with the home and the words `spans tiers`, and no
move is proposed.

### Where it shows

- **`scan`** prints one line under `wiring`:
  ```
  placement anchored 185/185 · owned 80 fit, 7 shared, 12 move in, 4 orphan · cohesive 12 fit, 1 away
  ```
  Each breaking file is listed under the line, the way contract drift is.
- **`model.json`** gets `placement`: per file, `{ kind, owner, home,
  verdict, users }`. `placementMeta` has the layouts with their shares.
- **Violations:** each verdict above, except fits and
  `could-move-down`, is a violation keyed by `rule|file|owner-or-home`. A
  baseline accepts today's, and `check --rule owned-shared` gates one rule.
- **`diff` and the change map** list the placement violations a change
  introduced, the same way they list contract drift. "A second transaction
  script imports a converter from the first one's folder" is what a reviewer
  should see on the PR that does it.
- **The workbench inspector** shows a brick's placement: "lives with
  CreateNoteTransactionScript", or "shared by 3 transaction scripts: belongs
  in `calendar-events/domain/transaction-scripts/`".

## Increments

1. The outward rule: list-valued `from` and `to` in `forbidden`, the rule in
   the nestjs profile, and `.params.ts` out of the `dto` pattern. It stands
   alone and can land first.
2. Users, and each station's own folder, in the model.
3. Layouts, with their shares, and the `inside-station` and `off-layout`
   verdicts.
4. Owned verdicts.
5. Cohesive verdicts.
6. Violations, and the `scan` line with its list.
7. `diff` and the change map.
8. The inspector.
9. README and skill.

Each increment has fixture tests in a small tree built for the verdict: one
converter shared by two transaction scripts, one DTO shared by two actions,
one projection filled by a repository, and so on.

## Acceptance

- The 0s hold on both trees: no anchored file inside another station's
  folder.
- omega's `RecurringEventToDomainConverter` is `cohesive-move-up`, and its
  home is `calendar-events/domain/transaction-scripts/`. It is the only
  `cohesive-move-up` in either tree.
- A fixture file `foo.result.ts` in a transaction script's own folder is
  `unnamed`, and none is in either tree.
- chronus's two shared projections and `get-note-by-id.responder.ts` are
  `owned-shared`.
- chronus's 11 transaction-script commands and omega's 23 fit, though the
  services that call those scripts import them.
- No response DTO built from its transaction script's projection is flagged
  for it: omega's `pending-invitation` and `calendar-member` DTOs.
- chronus's actions, services and repositories have no layout, and none is
  reported off one.
- A fixture change that makes a second transaction script import a
  converter from the first one's folder shows `cohesive-move-up` in `diff`.
- The outward rule flags chronus's 16 DTO files used by the domain and
  omega's `create-user.request.dto.ts`, each with its `why`. It does not
  flag a service building its transaction script's command.

## Out of scope

- **Moving anything.** Spec 18 turns a verdict into a move.
- **A React frontend's placement.** Components and hooks have their own
  cohesion rules, and none have been stated yet.
- **Module scoping** (`imports`/`exports`). Placement works within a module
  and treats `shared-kernel` as a module like any other.

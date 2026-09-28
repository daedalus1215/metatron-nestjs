---
title: Arrow-Property Trace Resolution
status: draft
project: metatron-nestjs
location: docs/specs/07-arrow-trace-resolution.md
created: 2026-09-17
tags: [scanner, correctness, call-graph]
---

# Arrow-Property Trace Resolution

## Context

The trace walker follows `this.x.y()` calls by reading method bodies. It looks
for methods one way: **the name, then `(`.** Method declarations work
(`startMeeting(userId) {`, `async startMeeting(userId) {`, decorated and
visibility variants). Arrow-function class properties do not:

```
startMeeting(userId) {        // name, then (    -> found
startMeeting = (userId) => {  // name, then =    -> not found
```

When the body is not found, the trace ends there — no diagnostic, no marker.
The scanner already promises the opposite at the entry: *a port we cannot
follow must say so rather than end a trace unannounced.* That promise stops at
the first hop.

**Measured on Kairos (2026-09-17).** Kairos writes every service, transaction
script, repository and mapper as an arrow property — 37 of 121 files (31%).
On a live scan: 23 endpoints, 22 of them (96%) with their terminal hop at
depth 1, landing on an arrow-property method. The transaction-script and
repository layers — the two most interesting layers — are absent from every
trace. Roughly 44+ hops are never reported. `diagnostics` is empty. The tool
is fully quiet about it.

All five other backends (chronus, nous, cereberus, omega, vereveil) contain
zero arrow-property files. The fix changes nothing for them — which is also
the safety net: if their models change, something went wrong.

## Goal

Traces run through arrow-property methods to the repository layer, and every
mid-trace stop is visible in the model. A cut trace must never again be
indistinguishable from a short one.

## Design

### Accepting the shape

Three sites in the scanner read method syntax with the same "name, then `(`"
regex:

| site | job |
|---|---|
| `nextMethodAfter` | binds a route decorator to its handler |
| `methodSig` | the signature shown on a trace hop |
| `methodBody` | finds the body the trace walks |

All three gain one new alternative: an identifier, then `=`, an optional
`async`, `(...)`, `=>` and `{`. The body search brace-matches from the `{`
after `=>`, reusing the brace matching the method-declaration path already
uses.

Accepted shapes:

```
name = (…) => {}
name = async (…) => {}
private name = (…) => {}        // and public / protected
```

The census found no modifier-prefixed arrow properties in any of the six
backends, but the alternative is one regex branch and one fixture line, and a
codebase that adds `private` later must not silently regress to truncation.

Explicitly not accepted: getters/setters (a different animal — no `this.x()`
walk in the same shape) and `name = someOtherFn(…)` (a value, not a method —
accepting it is a trap). Both fall through to the diagnostic below.

### The stall diagnostic

A mid-trace stop is currently silent in three cases: body not found, a
`this.x` that is not a constructor-injected dependency, and the depth cap
(5). All three emit one new diagnostic kind into the existing `diagnostics`
array, alongside `port-unbound` and the rest:

```js
{ kind: 'trace-stalled', file: '<rel>', method: '<name>', depth: n,
  reason: 'body-not-found' | 'dep-not-injected' | 'depth-cap' }
```

This extends the entry-binding promise to the middle of the chain: the next
unknown shape the scanner meets is a visible "stopped here, and why", not
another silent amputation.

The diagnostics are model-only: in the JSON, asserted in tests. No view
renders them in this spec (see Out of scope).

### Known limit, documented

The method-lookup regex is line-anchored but not class-scoped: it does not
know where a class starts and ends. Two classes in one file sharing a method
name can make the walker pick the wrong body. NestJS convention is one class
per file, and all six backends follow it, so the risk is documented rather
than engineered away. Class-body scoping is a new parsing mechanism the census
does not justify.

### Fixture

A new fixture project: a small NestJS app whose services, transaction script
and repository are arrow properties — plain, `async` and `private` variants —
plus one shape the scanner does not accept (a getter) that must produce a
`trace-stalled`. House rule: no new parsing without a fixture.

## Model changes

`diagnostics` gains the `trace-stalled` kind above. `endpoints[].flat` is
unchanged in shape — it simply gets longer on projects like Kairos.

## Explicit non-claim

This makes the walker understand one more shape and announce the ones it does
not. It does not make the walker exhaustive: the depth cap still cuts at 5,
and a `this.x` that is a class field rather than an injection is still not
followed — it is now said so. The fabricated `inferred: true` depth-0 hops for
entries that resolve nothing stay as they are; they are already flagged
inferred in the model, and removing them would change the five healthy
projects' models to fix nothing measurable.

## Out of scope

- Getters, setters, and non-arrow function-expression members.
- Class-body scoping of method lookup (documented as a known limit).
- Following `this.x` on non-injected class fields (diagnosed, not followed).
- Rendering diagnostics in any view — model-only. If a project ever has a
  non-zero stall count in practice, the surfacing gets its own spec with the
  view work.
- Raising the depth cap.

## Acceptance

- Kairos, in-memory scan: 22 of 23 endpoints reach the repository layer
  (depth ≥ 3); hop count rises from 37 to roughly 80 (exact number recorded
  in the implementation notes); `diagnostics` is empty — nothing stops.
- The other five backends: models byte-identical to `main` (worktree compare,
  `generatedAt` excluded).
- Fixture: the plain, `async` and `private` arrow shapes trace to the end; the
  getter shape produces exactly one `trace-stalled` with
  `reason: 'body-not-found'`; a hand-built `dep-not-injected` case and a
  hand-built depth-cap case each produce their reason.
- `metatron diff` on a Kairos commit reports affected endpoints through the
  full chain, not the first hop.
- `npm test` green.

## Implementation notes (2026-09-17)

Landed in `src/scan.js` — the three method-syntax sites now share one
`methodAnchor` helper carrying the arrow-property alternative, and `trace`
gains a `stall` helper emitting the three `trace-stalled` reasons — plus
`test/arrow-trace.test.js` over `test/fixtures/arrows/` (a `meet` app
exercising the plain, `async` and `private` arrow shapes, a getter, a
class-field dependency, and a seven-class `deep` chain that hits the depth
cap).

**Re-measured on the real projects, 2026-09-17.** The project set is chronus,
kairos, omega, cereberus, nous and vereveil; only vereveil carries an
`arch.config.js`, the other five scan on the default profile with `__dir` at
`backend/`.

| project | files | hops (old → new) | endpoints | new stalls |
|---|---|---|---|---|
| kairos | 121 | 37 → 153 | 23 | dep-not-injected ×9 |
| chronus | 362 | 287 → 287 | 64 | dep-not-injected ×6 |
| nous | 142 | 97 → 97 | 29 | dep-not-injected ×21, depth-cap ×1 |
| cereberus | 64 | 47 → 47 | 14 | — |
| omega | 209 | 147 → 147 | 28 | — |
| vereveil | 148 | 153 → 153 | 23 | — |

Kairos's file count matches the spec's census (121) exactly, and 22 of its
23 endpoints now reach a hop of kind `repository` — all but `/healthz`,
which has no dependencies. 19 of 23 reach depth ≥ 3; the four short ones
are `/healthz` (no calls), `/auth/me` (controller straight to repository)
and `/participants` + `/participants/:id` (controller → service →
repository). No trace contains a repeated (file, method) pair, so the 153
hops are shared subtrees re-traced once per endpoint, not a parse loop.

Every new stall on every project is a `this.x.y()` where `x` is a class
field (`logger = new Logger(…)`, `cache = new Map(…)`,
`activeMeetings = new Map(…)` — the common NestJS idiom), plus one genuine
depth-6 chain in nous (`summary/infra/remote-callers/ai-summary.remote-caller.ts`).
No `body-not-found` on any real project: nothing there calls a shape the
scanner does not accept.

**Deviations from the spec:**

- "Kairos … `diagnostics` is empty — nothing stops" — the prediction was
  wrong: nine `dep-not-injected` stalls in `meetings.gateway.ts`. The
  spec's normative text is explicit that non-injected `this.x` calls are
  "diagnosed, not followed", and the census that produced the prediction
  counted arrow-property files, not class-field calls. The behaviour
  stands; the prediction did not survive contact with the codebase.
- "The other five backends: models byte-identical to `main`" — holds for
  cereberus, omega and vereveil. On chronus and nous the only differing
  top-level key is `diagnostics` (the new stalls); endpoints, `flat`,
  edges and everything else are byte-identical. Same root cause: the
  premise "zero arrow-property files → nothing changes" did not anticipate
  the stall diagnostic surfacing class-field calls the scanner always
  skipped silently.
- "hop count rises from 37 to roughly 80" — measured 153. The estimate did
  not count shared subtrees being re-traced once per endpoint. The exact
  number is recorded here, as the acceptance line asks.
- "22 of 23 endpoints reach the repository layer (depth ≥ 3)" — the two
  readings disagree: 22 of 23 reach a `repository` hop; 19 of 23 reach
  depth ≥ 3. The substantive claim — the repository layer, absent from
  every old trace, is now present in nearly all of them — holds under the
  first reading.

**Design decisions the spec left open:**

- A stall is deduplicated per (file, method, reason) across the whole
  scan: the same gap reached from two endpoints is reported once.
- `dep-not-injected` fires only when the `this.x` is not a constructor
  parameter at all. An injected dependency whose type resolves to no
  scanned file (external packages) stays silent, as before — firing there
  would tag every call on an injected logger as a stall.
- A port file never emits `body-not-found` or `depth-cap`: a port is a
  declaration boundary with no body by design, and a trace that cannot
  cross it is already told by the port diagnostics (`port-unbound`,
  `port-ambiguous`, factory). Verified on the spec-05 ports fixture, whose
  three un-crossable ports would otherwise each have fired a false
  `body-not-found`.

**`metatron diff` check.** On Kairos commit `41b66a9` (81 changed files),
both versions report the same 14 affected endpoints — the change set
touches the services they all start from — but the attribution grows from
13 via files to 33: the 20 the old model never saw are the transaction
scripts, `meeting.repository.ts`, the mappers, the assemblers and
`participant-aggregator.ts`. Nothing the old model saw is lost.

`npm test` runs 65 tests; 7 are new, over `test/fixtures/arrows/` (the
three arrow shapes, the getter stall, the dep-not-injected stall, the
depth-cap stall, and the fixture's exact stall count).

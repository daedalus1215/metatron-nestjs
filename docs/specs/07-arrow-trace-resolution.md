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

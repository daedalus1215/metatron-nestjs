---
title: Test Presence Crossed With Risk
status: draft
project: metatron-nestjs
location: specs/06-test-coverage-crossing.md
created: 2026-08-24
tags: [analysis, testing, hotspots, findings]
---

# Test Presence Crossed With Risk

## Context

metatron already classifies `spec` files, already computes fan-in from
`fileLinks`, and already reads commit counts from git. It has never crossed
them. The crossing is the most directly actionable question the existing data
can answer:

> Which files change often, are widely depended on, and have no test?

**A discovered constraint.** The obvious implementation — look for a sibling
`foo.spec.ts` next to `foo.ts` — is wrong for this codebase. Chronus puts tests
in `__specs__/` subdirectories:

```
__specs__/ directories                      13
sibling *.spec.ts outside __specs__          0
total *.spec.ts                             22
```

A sibling-file heuristic would report **every file in Chronus as untested**, and
then rank them by risk, producing a confident and completely false report. The
test locator must be configurable, and it must be verifiable.

## Goal

Attribute test files to the source files they cover, cross that with churn and
fan-in, and report untested risk — with an explicit accuracy signal so the
result is never trusted blindly.

## Design

### Locating the test for a source file

A configurable resolver, defaulting to a list of strategies tried in order:

```js
testLocators: [
  (rel) => rel.replace(/\/([^/]+)\.ts$/, '/__specs__/$1.spec.ts'),  // Chronus
  (rel) => rel.replace(/\.ts$/, '.spec.ts'),                        // sibling
  (rel) => rel.replace(/^src\//, 'test/').replace(/\.ts$/, '.spec.ts'),
]
```

The first strategy producing a path that exists in the scanned file set wins.

### Reverse check, and why it exists

Resolving forward only tells you which sources have a test. It cannot tell you
the resolver is working. So also resolve **backwards**: every file classified
`spec` should be claimed by exactly one source file.

```
22 spec files · 22 matched to a source · 0 unmatched
```

If unmatched is high, the locator is misconfigured and the report is wrong. The
CLI warns and the finding suppresses itself:

```
!! 19 of 22 spec files could not be matched to a source file.
   The `testLocators` config does not fit this project's layout.
   Test findings suppressed — they would be wrong.
```

**Refusing to report is the correct behaviour here.** A wrong test-coverage
report is worse than none: it sends people to write tests for files that already
have them, and it discredits every other finding in the tool.

### Findings

```js
{ id: 'untested-risk', tone: 'warn',
  title: 'N high-risk files have no test',
  detail: 'Ranked by commits × dependents, the same score the hotspots lens
           uses. A file that changes often, is widely depended on, and is
           unverified is where a regression is both most likely and most costly.',
  items: ['notes/infra/repositories/note-memo-tag.repository.ts — 29 commits,
           19 dependents, no test'] }
```

Plus a `note`-toned summary giving the plain ratio by pattern, since "which
layers are tested" is its own question:

```
transaction-script  14/31    service  5/12    repository  1/9    aggregator  0/7
```

`aggregator 0/7` was spotted by hand earlier in this project's life. It should
be something the tool says, not something a person notices.

### Hotspots lens integration

The existing scatter gains an **untested toggle**, default on: files with no
test get a ring. The top-right quadrant — changes often, widely depended on —
with a ring on it is the highest-value square inch in the whole tool.

No new lens. This is an attribute of files, and `hotspots` is already the
file-risk lens.

## Model changes

```js
tests: {
  bySource: { '<src>': '<spec>' | null },
  unmatchedSpecs: ['...'],
  byPattern: { 'repository': { total: 9, tested: 1 } },
  meta: { specFiles: 22, matched: 22, strategy: 'index 0', reliable: true }
}
```

`meta.reliable` is false when the unmatched ratio exceeds 25%, and every
consumer must check it before rendering.

## Explicit non-claim

This measures **test presence, not test quality or line coverage.** A file with
a one-assertion smoke test counts as tested. The narration must say so plainly,
because "tested" is a word people over-read, and a green number that means less
than it appears is how a tool starts lying.

Real line coverage would mean parsing `lcov.info` from a Jest run — a reasonable
future addition, and deliberately not this spec, because it requires the test
suite to have been run and metatron's whole premise is static.

## Out of scope

- Line/branch coverage.
- Judging assertion quality or test count per file.
- E2E test attribution — an `*.e2e-spec.ts` covers a route, not a file, and
  belongs with endpoint data if it is ever done.

## Acceptance

- Chronus reports 22 of 22 spec files matched, `reliable: true`.
- Deliberately breaking `testLocators` produces the suppression warning and no
  test findings.
- `aggregator 0/7` appears without anyone having typed it.
- The hotspots ring toggle is screenshot-verified in both themes.

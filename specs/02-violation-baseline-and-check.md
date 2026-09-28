---
title: Violation Baseline and `metatron check`
status: implemented
project: metatron-nestjs
location: specs/02-violation-baseline-and-check.md
created: 2026-08-24
tags: [fitness-functions, ci, baseline, gating]
implemented: 2026-08-24
---

# Violation Baseline and `metatron check`

## Context

metatron currently *observes*. It reports that Chronus has N layer skips and M
cross-domain imports, and a human decides whether to care. Nothing stops the
number going up.

Chronus already has the seed of the opposite idea:
`specs/fitness-functions-implementation.md` proposes a `KNOWN_EXCEPTIONS` set to
grandfather pre-existing violations so new ones fail the build. That is a
ratchet, and metatron already computes every input it needs — it just throws the
comparison away on every run.

**Placement constraint, verified:** `.metatron/` is gitignored in this repo and
in consumer projects, because it is generated output. A ratchet that is not
committed cannot hold a line in CI. The baseline therefore lives **next to
`arch.config.js`**, as `arch.baseline.json`, and is committed. Output stays
disposable; the promise stays versioned.

## Goal

Turn the model into an executable architectural fitness function: known
violations are tolerated, new ones fail, and fixing one is recorded so it cannot
silently come back.

## Design

### What is a violation

Every `findings[]` entry with `tone: 'warn'` contributes violations, one per
entry in its `items[]`. `tone: 'good'` and `tone: 'note'` do not — a note is an
observation, not a debt. `absent-patterns` and `implicit-fk` stay notes
deliberately: they indict the config or the design, not the diff.

### Fingerprints

Each violation is identified by a stable hash of its semantic identity, not its
text:

```js
fingerprint = sha1(`${ruleId}|${from}|${to}`).slice(0, 12)
```

For findings whose items are single files rather than pairs (`orphans`,
`dead-shims`, `naming-*`), `to` is empty.

`arch.baseline.json`:

```json
{
  "version": 1,
  "generatedAt": "2026-08-24T10:00:00.000Z",
  "project": "chronus",
  "violations": {
    "a3f19c4b2e01": {
      "rule": "action>repository",
      "from": "notes/apps/actions/create-note/create-note.action.ts",
      "to": "notes/infra/repositories/note.repository.ts",
      "note": "legacy, pre-dates the aggregator"
    }
  }
}
```

`note` is hand-written and never overwritten by the tool — it is where the
reason a violation is tolerated gets recorded. This is the field that stops a
baseline degrading into an unexamined list.

Fingerprints were chosen over per-rule counts because the whole point of gating
a PR is to **name** the new violation. A count can say "3 became 4"; only a
fingerprint can say which one, and only a fingerprint catches a swap — one
violation fixed and another introduced in the same change, which a count passes
silently.

Renames surface as one removed plus one added. That is noise, but it is honest
noise: metatron cannot know a rename preserved intent, and pretending otherwise
would let a real violation ride in on a rename.

### Commands

```bash
metatron baseline              # write arch.baseline.json from a fresh scan
metatron baseline --update     # rewrite, preserving every `note` by fingerprint
metatron check                 # scan, compare, exit 0 or 1
```

`metatron check` output:

```
metatron check · chronus

  new violations        1
    action>repository   time-track/apps/actions/log-time/log-time.action.ts
                        -> time-tracks/infra/repositories/time-track.repository.ts

  fixed since baseline  2
    no-same-level       notes/domain/services/note.service.ts -> ...
    orphans             notes/domain/converters/legacy.converter.ts

  known, unchanged      14

FAIL — 1 new violation. Run `metatron baseline --update` to accept it.
```

Exit codes: `0` clean, `1` new violations, `2` scan or config error. Distinct
codes so CI can tell "the architecture regressed" from "the tool broke".

### Flags

| flag | effect |
|---|---|
| `--rule <id>` | gate on named rules only; everything else is advisory |
| `--allow-new <n>` | tolerate up to `n` new violations (default 0) |
| `--no-fixed` | suppress the fixed-since-baseline section |
| `--json` | machine-readable result for other tooling |

`--allow-new` exists so a team can adopt the gate mid-stream without a
big-bang cleanup, and ratchet it toward zero. It is a number in CI config, so
lowering it is a visible, reviewable act.

### Reporting fixed violations

A fingerprint in the baseline that no longer appears is reported, and **not**
removed automatically. Removal requires `--update`. Otherwise a flaky scan — a
file temporarily unparseable — would quietly retire a real debt, and it would
come back later as a "new" violation with no history.

## Model changes

- `violations: Violation[]` — flattened from `findings`, each with `fingerprint`,
  `rule`, `from`, `to`, `sev`. Derived, so no new scanning cost.

## Interaction with spec 01

`metatron check` is only trustworthy if the scan is. A four-space codebase today
mis-binds handlers, which would produce fabricated "new violations" in traces.
**Spec 01 lands first.**

## Out of scope

- Posting results anywhere. `check` writes to stdout and sets an exit code.
  Publishing is spec 04.
- Severity thresholds per rule beyond `--rule` filtering.

## Acceptance

- `metatron baseline && metatron check` on an unchanged tree exits 0 with zero
  new and zero fixed.
- Introducing one deliberate layer skip in a scratch branch exits 1 and names
  the exact file pair.
- Fixing a baselined violation is reported as fixed and does **not** mutate
  `arch.baseline.json` until `--update`.
- Hand-written `note` fields survive `--update`.

---

## Implementation notes (2026-08-24)

`src/violations.js` (fingerprinting and extraction), `src/baseline.js`
(read/write/compare), plus `baseline` and `check` in the CLI. `model.violations`
is derived at the end of `scan()`, so it travels with a cached model.

**Findings had to change shape.** The spec assumed a violation could be read off
`findings[].items[]`, but those are heterogeneous display strings — `no-upward`
formats as `why: from -> to`, `circular` as `a <-> b <-> c`, `orphans` as a bare
path. Parsing them back would have been fragile. Each warn finding now carries
`instances: [{from, to}]` alongside its `items`, and fingerprints are built from
structure rather than text.

**Two findings are explicitly ungateable.** `dag` reports SCC totals at four
carve-out levels and `app-apps` reports a spelling split across the tree; both
are observations about the whole codebase, not per-instance debt. They carry
`gate: false` and `metatron baseline` prints which rules are excluded, so a rule
cannot sit outside the gate unnoticed.

**`instances` is stripped from lens payloads** in `src/build.js`. It is
build-time data no template reads, and leaving it in cost ~2% on every lens.

**A bug found during the demo:** `--update` reported "1 note preserved" while
preserving none. The note belonged to a violation that no longer existed, so
dropping it was right — the count was not. `write()` now counts notes actually
carried over and reports dropped ones separately, since someone wrote that
sentence for a reason.

Verified on Chronus: 43 violations across 7 rules, `app-apps` correctly
excluded. Deleting one baseline entry makes `check` exit 1 and name the exact
file pair; `--rule` moves the others to a reported-but-not-gated section;
`--allow-new 1` passes. The demo baseline was removed afterwards — adopting the
ratchet in Chronus is a separate decision.

13 tests in `test/baseline.test.js`, 21 in the suite overall.


---
title: Violation Baseline and `metatron check`
status: draft
project: metatron-nestjs
location: specs/02-violation-baseline-and-check.md
created: 2026-08-24
tags: [fitness-functions, ci, baseline, gating]
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

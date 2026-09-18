---
title: metatron specs — index and sequencing
status: draft
project: metatron-nestjs
location: docs/specs/README.md
created: 2026-08-24
tags: [index, roadmap]
---

# Specs

Eight changes. 01–06 were written 2026-08-24 against `4c9d87b`; 07 and 08
were written 2026-09-17 against `d11ba66`. Numbered by dependency, not by
importance.

## Layout

Flat, numbered `NN-{kebab}.md` — this project has no tracker, so the number is
the ordering, assigned when the spec is written. Frontmatter: `title`,
`status`, `project`, `location`, `created`, `tags`, and `implemented` once the
work lands. One spec per unit of work.

| # | spec | kind | depends on |
|---|------|------|-----------|
| 01 | [Handler detection robustness](01-handler-detection-robustness.md) | correctness | — |
| 02 | [Violation baseline and `metatron check`](02-violation-baseline-and-check.md) | gating | 01 |
| 03 | [Logical coupling](03-logical-coupling.md) | new analysis | — |
| 04 | [Blast radius (`metatron diff`)](04-blast-radius.md) | new analysis | 01, 02 |
| 05 | [Port / adapter resolution](05-port-adapter-resolution.md) | precision | — |
| 06 | [Test presence crossed with risk](06-test-coverage-crossing.md) | new analysis | — |
| 07 | [Arrow-property trace resolution](07-arrow-trace-resolution.md) | correctness | — |
| 08 | [Focus lens (`?focus=`, city view)](08-focus-lens.md) | lens | 04 |

## Suggested order

**01 first, unconditionally.** It is a live correctness bug that produces
confidently wrong output on any four-space codebase, and every spec downstream
inherits its errors. Nothing that gates a build should sit on top of a scanner
that can mis-bind a route.

**Then 02**, because it is small, and because it converts metatron from
something you look at into something that holds a line. It is also the
prerequisite for 04, which is the feature that prompted this round.

**Then 03 or 05**, depending on appetite:

- **03 (logical coupling)** adds a signal the tool structurally cannot produce
  today. Highest ceiling, and the only item here that could change how the
  codebase is understood rather than how accurately it is described.
- **05 (port/adapter)** fixes a measured blind spot — 15 of 15 port hops
  dead-end, truncating the traces for merge, import and cross-context delete.
  Lower ceiling, higher certainty, and it makes the traffic lens honest about
  the four endpoints where the architecture is most interesting.

**06 is the cheapest real finding in the list** and can be slotted anywhere; it
needs no new machinery, only a crossing of data already in the model.

**04 last**, since it composes everything else.

**07 next** — it is a live correctness bug: on any codebase written with
arrow properties, every trace is amputated after the first hop, silently, and
everything trace-based (the traffic lens, `diff`'s affected endpoints)
inherits the cut. **08 behind it**: small, view-only, and it composes 04's
report.

## The thread running through the analyses

Three of these specs are mostly about *refusing to answer*:

- 01 adds `diagnostics` so an unparseable route is visible rather than dropped.
- 05 declines to resolve `useFactory` bindings and flags ambiguous ones instead
  of picking.
- 06 suppresses its own findings entirely when the test locator does not fit.
- 07 makes the mid-trace stop say so rather than ending a trace unannounced.

That is the same instinct as the coverage percentage: the failure mode of a
visualisation tool is not crashing, it is drawing a confident picture of
something it did not understand. Each new analysis needs its own version of the
coverage number, and each of these specs names one.

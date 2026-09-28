---
title: Focus Lens — ?focus= on the City View
status: draft
project: metatron-nestjs
location: docs/specs/08-focus-lens.md
created: 2026-09-17
tags: [lens, city, diff, url]
---

# Focus Lens — `?focus=` on the City View

## Context

`metatron diff` (spec 04) answers "what does this change touch?" in text:
blast radius, affected endpoints, a worth-a-look list. The city view shows the
whole city: one tower per module, one floor per directory, files hanging off
the floors. There is no bridge between the two: you can read the changed files
in the report, then stare at a city where nothing says which towers those
files are in.

Spec 04's out-of-scope named this: *rendering a filtered lens. If it is wanted
later it is a query parameter on the existing lens.*

## Goal

A URL parameter on the city view that dims everything outside a focus set, and
`metatron diff` prints a ready-to-open focus URL for the changed set — so the
report ends with a map, not just a list.

## Design

### The parameter

```
city.html?focus=chronus,auth
city.html?focus=chronus/chronus.controller.ts,auth/decorators/get-auth-user.decorator.ts
```

Comma-separated, URL-encoded. Each entry is either a module name (a tower) or
a file path in the model's scan-root-relative form — the same form the diff
report and the model keys use. A file resolves to its tower. An entry that
matches nothing lights nothing: the view refuses silently, which for a view is
honest — there is no stall to diagnose in a URL.

### The visual: dim, not hide

Towers outside the focus set fade to ghosts. The layout is invariant: no
reflow, no resize, no re-layout. Neighbours stay in frame, because the question
the view answers is "what this change touches, *inside* the city" — a
reflowed half-city answers "what is left?" instead. A small "focused on N —
clear" chip appears in the bar so focus mode is visible and dismissible
without touching the URL.

Why not hide: hiding is a different feature (a reflowed city is a filtered
city, useful for other questions). Dim is the focus answer.

### Where the set comes from

The parameter is the mechanism: durable, shareable, composable with anything
that later learns to print URLs. `metatron diff` fills it in:

- The terminal and markdown reports end with a focus line when the built view
  exists:

  ```
  focus: .metatron/city.html?focus=notes/domain/services/note.service.ts,check-items/…
  ```

  — the path of the last built view, not a guess.
- When the view has not been built, the report says `build the view first
  (metatron views)`. No dead links.
- `--json` carries the focus set as data (`focus: { paths: […], url: '…' |
  null }`), so tooling can build its own URLs.

### No model change

The city adapter already carries every file on every floor (`files` per node).
The client has the file-to-tower correspondence today. This spec adds no data
to the model, no adapter field, no rebuild — the URL does the work.

### Other lenses

The parameter is lens-agnostic by design (a set of model keys, resolved per
lens), so atlas or traffic can adopt it later with the same semantics. Only
the city view ships with it.

## Out of scope

- The other lenses (designed for, not shipped with).
- Hide/reflow mode.
- Build-time focus variants (pre-filtered view files) — the runtime parameter
  makes them unnecessary.
- Focus persistence beyond the URL. It is the URL.

## Acceptance

- `city.html?focus=<module>` ghosts every tower but the named one;
  `?focus=<file>` ghosts every tower but that file's; `?focus=<garbage>`
  shows the full city, unghosted, with no console errors.
- On a real change set, `metatron diff` prints a URL that opens to a city in
  which exactly the changed files' towers are lit; with no built view it
  prints the build hint; `--json` carries the paths.
- The clear chip restores the full city.
- Models byte-identical to `main` (view-only work — the scan is untouched).
- Screenshot-verified in both themes per the README procedure, with a real
  project's change set.

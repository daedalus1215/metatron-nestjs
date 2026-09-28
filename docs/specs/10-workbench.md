---
title: Workbench — metatron serve
status: draft
project: metatron-nestjs
location: docs/specs/10-workbench.md
created: 2026-09-26
tags: [lens, server, workbench, wiring]
---

# Workbench — `metatron serve`

## Context

Spec 09 put the wiring in the model: 271 bricks on chronus, their sockets
and studs, 271 wires and 387 calls, every one with a line range. Nothing
draws them yet.

Every lens so far is a self-contained HTML file with its data baked in at
build time. That suits a picture you share. It does not suit a workbench,
for two reasons:

- **Inspecting code needs the source.** Embedding 394 files into a page
  would bloat it, and the copy would go stale.
- **A workbench should follow the code as it changes.** Save a file, and the
  bricks should re-snap. A static file cannot rescan.

So this lens is served. It is the first thing metatron runs that does not
exit. The static lenses stay as they are.

## Goal

`metatron serve` opens a local page where you pick a brick and see it in
place:

- what it sits on (its sockets and the bricks they grip)
- what sits on it (the bricks wired into it)
- which studs each of those grips
- its source, one click away

The page re-scans when a file under the root changes.

## Design

### The server

```
metatron serve [path] [--port 4477] [--no-watch]
```

- **`node:http` only.** metatron has no runtime dependencies, and a
  workbench is no reason to start.
- **Binds `127.0.0.1`.** The page serves source code, so it is never
  reachable from the network. There is no flag to change that. Anyone who
  wants to expose it can put their own proxy in front, knowingly.
- It scans once at start, keeps the model in memory, and prints the URL.

| route | returns |
|---|---|
| `GET /` | the workbench page (`templates/serve/workbench.html`, served as is — outside the build's lens list) |
| `GET /api/model` | the workbench payload (below), with a `version` |
| `GET /api/source?file=<rel>` | the file's text, as scanned |
| `GET /api/events` | server-sent events: `{ version }` after each re-scan |

**`/api/source` reads from the scan, not the disk.** The scan already holds
every file's text, so the endpoint answers only for a path that is a key of
that map. There is no path joining, so there is nothing to traverse. It also
means the source shown always matches the model it is drawn beside, even
mid-save.

That requires `scan` to hand back its `text` map. It is added as a
non-enumerable property of the model, so it never reaches `model.json` or
any view.

**The payload** is the model minus what the workbench does not read:

```js
{ version, project, generatedAt, tiers, modules,
  bricks, wires, calls, wiringMeta,
  endpoints: [{ id, verb, route, file, cls, handler }],   // no traces, bodies or DTOs
  diagnostics }
```

### Watching

With `fs.watch(root, { recursive: true })`, any `.ts` change schedules a
re-scan 300 ms after the last event, so a save that touches several files
re-scans once. When the re-scan finishes, `version` goes up and every open
page is told over `/api/events`. The page refetches the model and keeps its
focus when the focused brick still exists.

A scan that throws does not replace the model. The error is sent as an
event, and the page shows it in its status bar, with the last good model
still drawn. A half-typed file must not blank the workbench.

`--no-watch` turns this off, and so does a platform without recursive
watch. The status bar then says the model is static.

### The page

Three columns:

```
┌ bricks ───────┬ bench ─────────────────────────────┬ inspector ──────────┐
│ search        │        [ GetThingAction ]          │ ThingService        │
│ module ▾      │            │ socket                │ service · notes     │
│ ☐ dto ☐ entity│        [ ThingService ]  ← focus   │ sockets             │
│               │         ●  ●  ○  ◌                 │   thingRepository ✓ │
│ ThingService  │      ┌─────┘                       │ studs               │
│ ThingAuditor  │  [ ThingRepository ]  [ date.utils ]│   find ● 2 callers  │
│ …             │                                    │ source ─────────────│
│               │                                    │ 21  async find(…) { │
└───────────────┴────────────────────────────────────┴─────────────────────┘
```

**The bricks column** is a searchable list of bricks, grouped by module.
Checkboxes hide patterns. `dto`, `entity`, `module` and `migration` are
hidden by default: they are bricks, but rarely the ones you want to wire
through. This is a lens decision, which is the reason 09 kept them in the
model.

**The bench** draws the focused brick and its neighbourhood as a stack:

- **Rows are tiers**, in the model's tier order. A request reads top to
  bottom: the action above the service, the service above the repository.
  A brick plugged into something two rows down is a layer skip you can see.
- **The neighbourhood** is the focused brick, the bricks it is wired or
  calls into (down, to a chosen depth, 1–3, default 2), and the bricks
  wired or calling into it (up, one hop). Within a row, bricks are ordered
  by the mean position of their neighbours: one barycentric pass, which is
  enough to untangle a neighbourhood this size.
- **A brick is a block**:
  - its **studs** are pips along the top edge: filled if a brick grips it,
    ringed for a route, square for the framework, dashed-hollow for
    `unseen`
  - its **sockets** are notches along the bottom edge, coloured by status
  - its tier sets the colour
  - a port is drawn hollow (dashed outline)
- **Wires** run from a socket notch to the top of the brick it grips. A wire
  through a port runs to the port, and a dotted line runs on to the class
  bound to it. 09 kept both ends so this could be drawn.
- **Hovering a stud** lights every call that grips it, and the callers'
  methods. **Hovering a socket** lights the studs gripped through it. This
  is where the Lego reading pays: which exact part of which brick is
  holding which.
- **Clicking a brick** focuses it. The focus is kept in the URL hash
  (`#b=<brick id>`), so the back button walks the path you took, and a link
  opens the same view.

**The inspector** shows the focused brick:

- header: file, module, pattern, tier, lines
- sockets: status and target
- studs: signature, grip, and the callers as links
- internals

Clicking any row scrolls the source panel to its lines.

**The source panel** shows the brick's own lines, fetched from
`/api/source`, with line numbers and a small built-in highlighter (keywords,
strings, comments; no CDN, the page works offline). Every call site on a
visible line (09's `calls[].line`) gets an inline marker, `→ ThingRepository.findById`,
which focuses the target brick when clicked.

### What the page refuses

- **No layout of the whole codebase.** 271 bricks and 387 calls in one
  picture is the hairball the city view exists to avoid. The bench always
  shows a neighbourhood.
- **No invented edges.** Only `wires` and `calls` are drawn. Imports stay
  in the atlas.

## Acceptance

1. `metatron serve` on chronus prints a `127.0.0.1` URL, and the page loads
   with no network access beyond that origin.
2. `/api/source` returns a scanned file's text. It returns 404 for any
   other path, including `../arch.config.js`, an absolute path, and a
   `.ts` file under the root that `ignore` excludes.
3. Editing a file under the root pushes a new `version`, and an open page
   redraws with its focus kept. A syntax error in the edited file leaves
   the previous model drawn, with the error in the status bar.
4. Focusing `NoteService` on chronus draws its actions above and its
   transaction scripts, repositories and aggregators below. Hovering a stud
   lights exactly the calls in `calls` whose `toMethod` is that stud.
5. Server tests (`test/serve.test.js`) start on port 0 against the wiring
   fixture and cover the API routes, the refused paths, and a re-scan after
   a file write.

## Out of scope

- **The change overlay.** That's 11, which adds `/api/diff?range=` and
  paints the bench.
- **Editing code from the page.** The workbench reads.
- **The frontend scanner.** When it exists it produces the same brick
  shape, and the page should not need to change.

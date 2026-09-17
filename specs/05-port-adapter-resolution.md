---
title: Port / Adapter Resolution Through Module Providers
status: implemented
project: metatron-nestjs
location: specs/05-port-adapter-resolution.md
created: 2026-08-24
tags: [scanner, dependency-injection, call-graph, hexagonal]
implemented: 2026-09-14
---

# Port / Adapter Resolution Through Module Providers

## Context

The README says "DI tokens are invisible … anything Nest resolves through a
string token leaves no edge". Investigating Chronus shows the real situation is
both narrower and worse than that.

Chronus does not use string tokens. It uses **symbol tokens with an interface
type**, the textbook hexagonal shape:

```ts
// folders/domain/transaction-scripts/delete-folder.transaction-script.ts
constructor(
  private readonly folderRepository: FolderRepository,
  @Inject(NOTE_FOLDER_PORT)
  private readonly noteFolderPort: NoteFolderPort
) {}
```

```ts
// notes/notes.module.ts
{ provide: NOTE_FOLDER_PORT, useExisting: NoteFolderAdapter }
```

The injection parser at `src/scan.js:206` strips `@Inject(...)` and reads the
type annotation, so it **does** produce an edge — to `NoteFolderPort`, the
interface. An interface has no method bodies, so when `trace()` reaches it,
`methodBody()` returns `null` and the trace stops.

Measured on Chronus:

```
port hops in traces                15
port hops that dead-end            15   (all of them)
endpoints with a truncated trace    4   of 63
```

And those four are the least ordinary endpoints in the system:

```
DELETE /folders/:id     POST /notes/import
POST /notes/merge       POST /notes/:id/merge
```

Cross-context deletion and the entire note-transfer feature. The traffic lens
draws these traces ending at an interface, and the picture is not wrong so much
as **stopped** — with no indication that it stopped.

This is the cost of the architecture working as designed: ports exist precisely
to prevent the caller knowing the implementation, and the scanner inherits that
ignorance. The module file is where the knowledge lives, and metatron already
reads every module file.

## Goal

Follow a call through a port to the adapter that Nest actually binds, and mark
the hop as resolved-through-DI rather than passing it off as a direct call.

## Design

### Build a provider binding table

For each file classified `module`, parse the `providers` array and collect
object-literal providers:

| form | resolution |
|---|---|
| `{ provide: TOKEN, useClass: Impl }` | `TOKEN → Impl` |
| `{ provide: TOKEN, useExisting: Impl }` | `TOKEN → Impl` |
| `{ provide: TOKEN, useValue: x }` | record, do not resolve |
| `{ provide: TOKEN, useFactory: fn }` | record, do not resolve |

`TOKEN` and `Impl` are both symbols resolved through the existing per-file
`symbolIndex`, which already maps an imported name to its file. String-literal
tokens (`provide: 'FOO'`) are keyed by the literal instead and matched against
`@Inject('FOO')` — supported, though Chronus does not use it.

`useFactory` is deliberately unresolved: a factory can return anything, and
guessing would be exactly the kind of confident wrongness this tool exists to
avoid. Record it so it can be reported, not followed.

### Resolve at injection time

When parsing a constructor parameter that carries `@Inject(TOKEN)`, record both:

```js
{ prop, type: 'NoteFolderPort', file: '<port interface file>',
  token: 'NOTE_FOLDER_PORT',
  boundTo: '<adapter file>',        // null if unresolvable
  boundVia: 'useExisting',
  boundIn: 'notes/notes.module.ts' }
```

Keep `file` pointing at the port. The import edge to the interface is real and
should stay in the graph; `boundTo` is additional knowledge, not a replacement.

### Continue the trace

In `trace()` (`src/scan.js:471`), when a call resolves to an injection with a
`boundTo`, look the method up on the **adapter** and continue from there. Emit
the hop with the port's identity preserved:

```js
{ file: '<adapter>', cls: 'NoteFolderAdapter', kind: 'adapter',
  viaPort: 'NoteFolderPort', boundIn: 'notes/notes.module.ts', ... }
```

The traffic lens renders `viaPort` hops with a distinct marker. **The
indirection is architecturally meaningful and must not be erased** — a reader
needs to see that the call crossed a context through a port, not that it called
the adapter directly. Flattening that would misrepresent the design as tighter
coupling than it is.

### Diagnostics

Report a port injection that could not be bound:

```js
{ kind: 'port-unbound', file, token, reason: 'no provider found' | 'useFactory' }
```

An unbound port is worth knowing about independently: it is either a provider
registered somewhere the scanner does not look, or a genuine wiring gap.

### Cross-module binding

A token is often injected in one module and provided in another
(`NOTE_FOLDER_PORT` is injected in `folders/` and provided in `notes/`). The
binding table is therefore **global across all module files**, not per-module.

If two modules bind the same token to different implementations, record both and
emit a `port-ambiguous` diagnostic rather than picking one. Nest resolves that by
module scope, which this scanner does not model, and a coin-flip would be worse
than an admission.

## Model changes

- `injects[].token`, `.boundTo`, `.boundVia`, `.boundIn`
- `endpoints[].flat[].viaPort`, `.boundIn`
- `bindings: [{ token, impl, via, module }]` — new top-level array
- `diagnostics` gains `port-unbound`, `port-ambiguous`

## Out of scope

- Module scoping and visibility rules (`exports`, `imports`, global modules).
  The binding table is flat.
- `forwardRef` cycles.
- Dynamic modules (`register()` / `forRootAsync()`), which are `useFactory` by
  another name and stay unresolved.

## Acceptance

- Chronus's port hops that dead-end drops from 15 to 0, or every remainder has a
  diagnostic explaining why.
- The four truncated endpoints produce deeper traces, manually verified against
  the source for at least `POST /notes/import`.
- Total endpoints stays 63 and no existing trace gets shorter.
- The traffic lens visibly marks a through-port hop; screenshot-verified.

## Implementation notes (2026-09-14)

Landed in `src/scan.js`: a global binding table built from every `provide:` in
a `*.module.ts`, resolved when a constructor parameter carries `@Inject(TOKEN)`,
and followed by `trace()`. `enclosingBrace()` joins the parse primitives.

**Measured on Chronus**, against `main` at `2f66867`:

```
port hops that dead-end            15 -> 0
endpoints with a truncated trace    4 -> 0
endpoints                          64 -> 64
hops                              260 -> 287
bindings                            7    (all useExisting)
port diagnostics                    0
```

Chronus has 64 endpoints now, not the 63 this spec was written against. 60 of
them have byte-identical traces, and every part of the model outside
`endpoints`, `bindings` and `diagnostics` is byte-identical. The four truncated
endpoints are resolved; no hop was lost from any trace. `DELETE /folders/:id`
stays at 5 hops: `NoteFolderAdapter` calls a TypeORM `Repository<Note>`, an
external type, so the trace now ends at the real adapter instead of the
interface.

`POST /notes/import` checked by hand against the source: `ImportNote.apply`
calls the four ports, and each bound aggregator's body calls exactly the
repository methods the trace lists.

nous, kairos and cereberus: traces unchanged, no diagnostics. kairos binds
`PARTICIPANT_AGGREGATOR` with `useClass` and injects it in three transaction
scripts, but no endpoint trace reaches them — `MeetingService` declares its
methods as arrow-function properties (`startMeeting = async (...) => {}`), which
`methodBody()` does not read. That gap predates this spec.

**Deviations from the spec:**

- The bound hop *replaces* the port hop rather than following it, so a hop
  count is still a count of calls. `kind` is the implementation's own pattern —
  five of Chronus's seven bindings land on aggregators, not adapters — and
  `viaPort`, `token` and `boundIn` carry the port, so nothing is lost.
- Diagnostics keep the existing `{ kind, file, line, detail }` shape plus
  `token`, rather than `{ token, reason }`, so the CLI prints them unchanged.
- `useValue` is recorded but never diagnosed: it is data, not an implementation.
- "No provider found" is reported only for a token declared in the scanned tree
  that is not a class. A string or package token may be provided by a module
  metatron never sees, and a class used as its own token is ordinary DI.
- Ambiguity is judged on distinct `via` + implementation, so one token provided
  the same way in two modules is not reported.
- Provider objects are found by walking back from each `provide:` to its
  enclosing brace, not by splitting the `providers` array. `splitTop` counts the
  `>` of a `useFactory: () =>` arrow as a closing bracket and would lose every
  provider after it; the fixture puts one first on purpose.

**Lens.** `traffic` rings any stop reached through a port with a dashed circle,
adds it to the legend, and the inspector's trace says `through NoteWriterPort`,
with the token and module in its tooltip. Screenshot-verified in both themes.

**Found along the way (fixed 2026-09-16, see below):**

- `traffic`'s lane labels are one tier off. The template hardcodes seven lanes;
  the profile's tiers are Entry, Contract, Service, Aggregator, Transaction
  Script, … so "Service" is drawn under a Contract heading, and Domain Model
  (tier 7, where ports live) has no lane. The observation cards keyed on lanes 1
  and 2 inherit the error, and one of them has "of 63 endpoints" typed in.
- `hl()` in `traffic` highlights the keyword `class` inside the `<span
  class="d">` it has just inserted, so decorators render as `class="d">@IsNumber()`.
- The animation loop logs `<circle> attribute cx: NaN` once on load (also on `main`).

`npm test` runs 32 tests; 11 are new, over `test/fixtures/ports/`.

## Traffic view fixes (2026-09-16)

The three bugs above, fixed on `fix/traffic-lanes`:

- **Lanes now come from the model.** `adapters/traffic.js` passes `tiers`, and
  the template builds its lanes from `D.tiers` instead of a typed seven-lane
  list. All eleven default tiers are drawn, so Domain Model (tier 7, where
  ports live) has a lane, and every column is labelled with the tier that
  actually sits there. The lane palette is the atlas's tier-to-colour mapping,
  so a tier keeps its colour across views, and the inspector's hop chips are
  recoloured to match the tier their kind belongs to.
- **The observation cards key on tier names, not lane indices**, found by name
  in `D.tiers`, and drop the card when the model has no tier of that name.
  "of 63 endpoints" is now the model's own endpoint count.
- **No typed numbers remain in the template.** The footer (endpoints, traced
  hops, distinct classes), the section 02 prose (endpoints with no calls,
  deepest trace) and the index blurb are all computed from the model.
- **`hl()` runs keywords before decorators**, so the `class` in the inserted
  `class="d"` attribute is no longer wrapped in its own keyword span.
- **The NaN is the first frame's timestamp.** `t0` is `performance.now()` at
  script time, but the first `requestAnimationFrame` callback can be
  timestamped earlier — the frame's begin time, before the script ran within
  that frame. `dt` and `acc` start negative, a negative `phase` floors `k` to
  `-1`, `xs[-1]` is `undefined`, and the first dot's `cx` becomes `NaN` for
  exactly one frame. Clamping `phase` back into `[0,1)` removes it; the first
  frame simply starts the dots a few percent into their cycle.

Verified on chronus, cereberus, omega and vereveil: scanned with the branch
and with `main` in a worktree, every part of the model is byte-identical, so
the fix is template and adapter only. Headless Chromium logs no console errors
across repeated loads (the NaN previously logged once per load), and
screenshots in both themes show the eleven lanes, port stops in the Domain
Model lane, and clean decorators in the inspector.

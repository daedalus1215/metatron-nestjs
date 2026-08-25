---
title: Port / Adapter Resolution Through Module Providers
status: draft
project: metatron-nestjs
location: specs/05-port-adapter-resolution.md
created: 2026-08-24
tags: [scanner, dependency-injection, call-graph, hexagonal]
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

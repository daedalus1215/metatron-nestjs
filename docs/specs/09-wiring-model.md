---
title: Wiring Model — bricks, sockets, studs
status: draft
project: metatron-nestjs
location: docs/specs/09-wiring-model.md
created: 2026-09-26
tags: [scanner, model, call-graph, workbench]
---

# Wiring Model — bricks, sockets, studs

## Context

Every graph metatron saves is either a file-to-file `import` (`fileLinks`) or
a call path hanging off an endpoint (`endpoints[].flat`). Neither one is how
a Nest backend is actually put together. What holds it together is
injection: a constructor names what it needs, and a module decides what
fills it.

The scanner already works this out and throws it away. `injects`
(`scan.js`, "constructor injections") resolves every constructor parameter
to a file, and through `bindings` to the class behind a port. It lives only
long enough to feed `trace()`. `trace()` follows `this.x.method()` calls,
but only from an endpoint handler downward, so a call on a path no route
reaches is never recorded.

It also assumes one class per file. `injects` reads the first
`constructor(` in the file, and `className` reads the first
`export class`. A second class with a constructor would lend its sockets to
the first one, or lose them.

This spec is the prerequisite for two lenses that come after it:

- **10 — the workbench** (`metatron serve`): a local server where you pick
  a class, see what it is snapped into, expand outward, and read the source.
- **11 — the change overlay**: the workbench opened on a git range or a PR,
  with every brick and connection labelled new, rewired, edited or removed.

Both need a class-level model with stable identities and line ranges. That
is all this spec adds. It renders nothing.

**Measured on chronus (2026-09-26), 336 non-spec files:**

| shape | files | brick? |
|---|---|---|
| exactly one class | 233 (69%) | yes: the class |
| more than one class | 7 | one per class. All 7 are nested DTOs, none has a constructor |
| no class, exported functions | 16 | yes: the file, with its functions as studs |
| no class, only types / interfaces / consts / enums | 80 | no, unless it is a port (below) |

On omega, 197 files: 124 with one class, 2 with more than one (neither has a
constructor), 71 with no class, 5 of those with exported functions.

Across both backends there are zero multi-class files with a constructor.
The one-class assumption has not produced a wrong answer yet. That makes it
the safety net, the same one spec 07 used: fixing the assumption must not
change a single existing field on either model.

## Goal

The model carries every brick in the codebase: what it needs, what it
offers, and what it is plugged into. Each has an identity that stays the
same across scans and a line range for every part. It also carries its own
coverage number, so a socket the scanner could not resolve is counted, not
drawn as if it were empty.

## Design

### The brick

A brick is the smallest unit that can be wired. What that is depends on
what the file contains:

| file contains | bricks | id |
|---|---|---|
| one class | the class | `path/to/file.ts#ClassName` |
| several classes | one per class | `path/to/file.ts#ClassName` each |
| no class, exported functions | the file | `path/to/file.ts` |
| a port (`pattern: 'port'`) with no class | the file: a hollow brick | `path/to/file.ts` |
| types, interfaces, consts, enums only | not a brick | — |

Two cases the table leaves open:

- **A file with classes *and* exported functions** gets both: a brick per
  class, plus one `functions` brick for the file. Their ids cannot collide,
  because only the class bricks carry `#`.
- **Files in the Test tier (`spec`, `test-util`) produce no bricks.** A test
  double is a class too, but drawing `FakeRepository` next to
  `ThingRepository` would double every part. What tests reach is already
  recorded in `tests`.

Entities, DTOs and modules are classes, so they are bricks. They have few
sockets or none, and the workbench can filter them by `pattern`. Leaving
them out of the model would be a lens decision made in the wrong place.

The id always contains the file path. The file is the brick's address,
because git, `diff` and `?focus=` all work in files. The `#Class` suffix is
what lets two classes share an address.

A **port is a hollow brick**. It declares a shape (its interface methods are
its studs) but has no body. Leaving ports out would hide the indirection
spec 05 went to the trouble of preserving.

Types-only files stay out of the brick set. They are contracts, not parts,
and `fileLinks` already carries who depends on them. Drawing 80 of them as
bricks would bury the 250 that do something.

```js
bricks: [{
  id: 'notes/domain/services/note.service.ts#NoteService',
  file: 'notes/domain/services/note.service.ts',
  name: 'NoteService',
  shape: 'class',          // 'class' | 'functions' | 'port'
  module: 'notes', pattern: 'service', tier: 4,
  lines: [12, 188],        // 1-indexed, inclusive; whole file for 'functions'
  decorators: ['Injectable'],
  extends: null,           // superclass name, recorded not followed (see Out of scope)
  sockets: [ … ],          // what it needs (constructor), class bricks only
  studs: [ … ],            // what it offers (public methods / exported functions)
  internals: [ … ],        // private/protected methods: not studs, but readable
}]
```

### Sockets: what a brick needs

One socket per constructor parameter, in declaration order:

```js
{ prop: 'noteRepository', type: 'NoteRepository', line: 15,
  to: 'notes/infra/repositories/note.repository.ts#NoteRepository',
  status: 'resolved' }
```

| status | meaning | `to` |
|---|---|---|
| `resolved` | the type is a class in the scanned tree | its brick id |
| `port` | `@Inject(TOKEN)`, bound by a module | the port's brick id, plus `boundTo` (the implementing brick), `token` and `boundIn` |
| `framework` | a type in `EXTERNAL_TYPES` (`Repository`, `ConfigService`, …) | `null`. Instead: `external: 'Repository<Note>'`, and for `@InjectRepository(Note)` the entity's file in `entity` |
| `unresolved` | none of the above: an import from a package metatron doesn't know, or a type it couldn't read | `null`, plus a diagnostic |

The port keeps both ends, the interface it was declared against and the
class that fills it. The same rule as `viaPortOf`: the indirection means
something architecturally and must not be erased.

`@InjectRepository` is 27 injections on chronus. Calling those
`unresolved` would drag the coverage number down for a dependency the
scanner fully understands. Calling them `resolved` would draw a socket
plugged into an entity, which is not what Nest does. `framework` is the
honest third answer: Nest provides it, and here is what it is typed
against.

### Studs: what a brick offers

```js
{ name: 'findById', sig: 'findById(id: number, userId: number): Promise<Note>',
  lines: [41, 58], async: true, kind: 'method',   // 'method' | 'function' | 'declared'
  static: false,
  route: null,             // endpoint id when this stud is a route handler
  grip: 'brick' }          // 'brick' | 'route' | 'unseen' (see Gripped studs)
```

- Class bricks: public methods, meaning no `private` or `protected`. Both the
  method form and the arrow-property form count, through the same
  `methodAnchor` spec 07 fixed, so the two readings cannot drift apart.
  `constructor` is not a stud.
- **Static methods are studs**, with `static: true`. They are called as
  `ClassName.method()` with nothing injected, so no socket or wire leads to
  them. Calls to them are still recorded (see Connections).
- **Getters and setters are not studs, and not internals.** They read as
  fields, and a `get x()` drawn as a stud would suggest a part you plug into.
  The source panel shows them where they are in the class body.
- **Route handlers are studs** with `route` set to the endpoint's id from
  `endpoints`. HTTP grips an action's handler, not another brick. Marking it
  keeps "gripped only by a route" apart from "gripped by nothing".
- **A public method called only from inside its own class is still a
  stud.** A stud is what the brick *declares* it offers. Whether anything
  takes it up is a separate fact (below), and merging the two would hide
  exactly the case worth seeing.
- Function bricks: each exported `function` and exported arrow `const`.
- Port bricks: interface method signatures, `kind: 'declared'`, no body
  lines.

`internals` has the same shape for private and protected methods. The
workbench needs them for reading the source. Spec 11 needs them because an
edit to a private method is still an edit to the brick.

### Connections

Two edge lists, both between brick ids:

```js
wires: [{ from: '…#NoteService', to: '…#NoteRepository', prop: 'noteRepository',
          via: 'type' }]                  // 'type' | 'port'; port wires carry boundTo
calls: [{ from: '…#NoteService', fromMethod: 'archive',
          to: '…#NoteRepository', toMethod: 'save', line: 77 }]
```

- **`wires`** are the snaps: exactly the resolved and port sockets, as edges.
  They are kept separate from `sockets` so the lens and the change overlay
  can compare edge sets without walking every brick.
- **`calls`** apply the `trace()` regex (`this.x.method(`) to *every* stud
  and internal method of every class brick, not only those an endpoint
  reaches. A call through a port records the port as `to` and the
  implementation as `boundTo`, like a wire.
- **Calls into function bricks.** For each name a file imports from a
  function brick (`symbolIndex` already has these), record every
  `name(` call site that falls inside a method or function range. A call
  outside any range (module-level code) is recorded with a null method.
- **Static calls.** For each class name a file imports, a
  `ClassName.method(` call site where `method` is a static stud of that
  brick is recorded the same way, with `static: true`. No wire goes with
  it, and that is correct: nothing was injected.
- **Self-calls** (`this.method(`) are not recorded. They are wiring inside
  one brick, not between bricks, and the source panel shows them where they
  are.

### Gripped studs

A wire says one brick sits on another. A call says *which stud* it grips.
Once `calls` exist, every stud gets a `grip`:

| grip | meaning |
|---|---|
| `brick` | at least one other brick calls it |
| `route` | no brick calls it, but it is a route handler |
| `unseen` | no call metatron can read reaches it |

It is `unseen`, not `none`. The call shapes listed under Out of scope
(destructured deps, optional chaining, aliases) are invisible to this scan,
as are calls from outside the scanned tree. `unseen` is a lead to check,
not a claim that the method is dead. The workbench (10) can show these
studs as unpainted. Spec 11 can flag a new stud that nothing grips.

`wiringMeta` gains `studs: { total, brick, route, unseen }`, so the
share of `unseen` studs is visible before anyone reads the list.

The trace does not duplicate this. After this spec, `trace()` reads its
injections from the brick's sockets instead of `injects[rel]`. For a
single-class file the two are identical, which is what the acceptance test
checks.

### Parsing several classes per file

The class scan finds every `class Name` declaration (exported or not, and
`abstract` allowed). It matches its body brace with `matchBrace` and reads
constructor, methods and decorators *inside that body only*. `className`
and the constructor read in `injects` both become per-class.

`fileNodes[].cls` stays the first exported class. It is an existing field,
and its meaning must not change under the lenses that read it.

### The coverage number

Printed after `coverage`, in the same style:

```
wiring   412/431 sockets resolved (95.6%)     27 framework · 19 unresolved
```

`framework` counts toward resolved. Nest provides it, and the scanner knows
what it is. Every unresolved socket gets a diagnostic, in the same format
spec 01 established:

```
socket-unresolved  notes/…/note.service.ts:15  clock: Clock — no class named Clock in the scanned tree
```

It is saved as `wiringMeta: { sockets, resolved, framework, unresolved, studs }`.
Unlike `coverage`, it does not warn below a threshold yet. There is one
measurement to calibrate against, and a threshold picked now would be a
guess.

### Size

Chronus's model is 600 KB. Roughly 250 bricks, about 4 studs each, and
about 600 call sites should add under 150 KB. Nothing is embedded in any
existing view. Only 10 reads these keys.

## Acceptance

1. **The safety net.** On chronus and omega, the model before and after is
   identical on every existing key, `endpoints[].flat` included. Only
   `bricks`, `wires`, `calls` and `wiringMeta` are added. A change to an
   existing key means the per-class parse broke something.
2. A new fixture, `test/fixtures/wiring`, covers:
   - a file with two injectable classes, each with its own constructor. Each
     gets its own sockets, and neither borrows the other's
   - an arrow-property service, whose studs are found (spec 07's shapes)
   - a `utils.ts` with three exported functions, called from a service.
     This gives one function brick with three studs, and `calls` into it
     with the calling method named
   - a port injected by token and bound with `useExisting`. The socket is
     `port`, and both the wire and the call carry `boundTo`
   - `@InjectRepository(Thing)`: the socket is `framework`, with `entity`
     set
   - a parameter typed as an unknown class. The socket is `unresolved`,
     with one diagnostic
   - a types-only file, which produces no brick
   - a static method called as `ClassName.method()` from another brick.
     The stud has `static: true`, and the call is recorded with no wire
   - a getter and a setter, which produce neither studs nor internals
   - an action's route handler with no brick calling it: `route` set,
     `grip: 'route'`
   - a public method called only through `this.` inside its own class:
     it is a stud with `grip: 'unseen'`, and no call edge is recorded
3. Brick ids are stable. Two scans of the same tree produce identical
   `bricks`, sorted by id.
4. `metatron scan` prints the `wiring` line.

## Out of scope

- **Any rendering.** That's 10.
- **Comparing two scans' bricks.** That's 11, which will compare the
  `bricks` and `wires` of the base scan against the head scan that `diff`
  already produces, and use stud `lines` against the hunk ranges to say
  *which* method changed.
- **Calls through anything other than `this.x.method(`**: destructured
  deps, `this.x?.method(`, calls through a local alias. `trace()` doesn't
  follow these today either. If they matter, they are one fix that improves
  both.
- **Inheritance.** A class that `extends` another inherits its
  constructor and methods. Recording `extends` as a field is cheap and is
  included. Merging an inherited constructor's sockets is not: the base
  class's parameters are passed through `super(…)`, and reading that is a
  separate problem.
- **The frontend.** A React scanner is a later project. The brick shape was
  chosen so it could take one: a component is a brick, its props and the
  hooks and context it consumes are its sockets, and what it renders are
  its connections. None of that is built here.

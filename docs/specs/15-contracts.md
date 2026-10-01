---
title: Contracts — request and response shapes across the stack
status: draft
project: metatron-nestjs
location: docs/specs/15-contracts.md
created: 2026-09-30
tags: [bridge, full-stack, types, dto, contract]
---

# Contracts — request and response shapes across the stack

## Context

The bridge (spec 12) matches each frontend HTTP call to the endpoint it
reaches, by verb and path. Specs 13 and 14 report a call that reaches
nothing. Neither looks at **what travels** along a matched call:

- **the body the frontend sends**, against the DTO the endpoint validates
- **the type the frontend expects back**, against the type the handler
  declares

Both sides already write these down. The frontend has generics
(`api.get<Note>(…)`), typed parameters and return types. The backend has
`@Body() dto: CreateNoteDto` and `Promise<NoteResponseDto>`.

**Measured with a prototype (2026-09-30).** The prototype read top-level
field names and optionality, and whether the value is an array:

| | chronus | omega |
|---|---|---|
| matched calls | 69 | 27 |
| request bodies readable on both sides | 24 | 13 |
| … that disagree | 0 | 0 |
| responses readable on both sides | 36 | 19 |
| … that disagree | **6** | 0 |

All six chronus responses were checked by hand, and each is real
disagreement between the two sides' declarations:

- **`GET /notes/detail/:id` and `PATCH /notes/detail/:id`:** the frontend's
  `Note` has `pinned`; `NoteResponseDto` does not declare it. The pin
  feature added it to the entity and the frontend, not to the response DTO,
  so it is also missing from the Swagger docs.
- **`GET /notes/explorer-names`:** the frontend expects `sortOrder`. The
  repository's SQL selects it, but the declared `NoteNameRow` type omits it.
- **`GET /tags/:id` and `PATCH /tags/:id`:** the frontend's `Tag` claims
  `noteCount`; `TagResponseDto` has `id`, `name` and `description` only.
- **`PATCH /notes/:id/archive`:** the frontend's `NoteResponse` claims
  `checkItems`, `description` and `isMemo`. The handler is declared to
  return the `Note` entity.

None of these crashes chronus today. Each one is a place where a type on one
side makes a promise the other side's type does not keep, and that is how a
field silently goes missing in a later change.

**What the prototype got wrong,** and what the real reader must do instead:

| trap | what the reader must do |
|---|---|
| `@IsOptional()` makes a DTO field optional, with no `?` | read the decorator |
| a body typed inline: `data: { name: string; parentId?: number }` | read the parameter's own annotation |
| a regex took the next call's generic | take the generic from the call itself |
| a bodyless call to a bodyless endpoint | count it as agreement, not "unreadable" |

## Goal

Every matched call carries a **contract**: for the request and for the
response, whether the two sides' declared shapes agree, differ (and how),
or cannot both be read. A change that makes them differ is reported where
broken calls are, in the stack section of `diff` and the workbench.

## Design

### Reading a shape

A shape is a value's top-level fields, each with its optionality, plus
whether the value is an array. Only names and optionality are compared:
field *types* are recorded for display, not compared. `number` against
`Note['id']` is not a disagreement anyone wants reported.

What is read, on either side:

- **object literal types:** `{ a: string; b?: number }`
- **named types:** a `type X = { … }`, an `interface X { … }` (with its
  `extends`), or a class (its fields)
- **`T[]` and `Array<T>`:** an array of T
- **`Promise<T>`:** T
- **`Partial<T>`:** T with every field optional
- **`A & B`:** both
- **`void`, `undefined`, `null`:** nothing
- **anything else** (a generic of our own, a conditional, a package type):
  **unread**

In a class, a field is optional when it has `?` **or** `@IsOptional()` /
`@ValidateIf(…)`. That is how class-validator says it.

Named types are looked up in the side's own tree, through the file's
imports first, then by name across the tree. A name defined twice is
unread, never guessed between.

### What each side declares

**The frontend,** per HTTP call:

- **the body:** the second argument of `post` / `put` / `patch`, or
  `fetch`'s `body: JSON.stringify(x)`:
  - an object literal gives its keys (a `...spread` in it makes the shape
    open: extra keys are not reported)
  - an identifier gives the type its parameter or `const` declares, read
    from the enclosing function's own signature
  - nothing means no body
- **the expected response:** the call's own generic (`api.get<T>(`).
  Failing that, the enclosing function's declared return type, when that
  function makes exactly one call.

**The backend,** per endpoint:

- **the body:** the `@Body()` parameter's type. `@Body('name')` is a
  one-field body.
- **the response:** the handler's declared return type. A handler with a
  `@Res()` parameter writes its own response, and is unread.

### Comparing

| | differ when |
|---|---|
| request | the frontend sends a key the DTO does not declare (a closed literal or a named type); the DTO requires a field the frontend does not send, or sends as optional; one side has a body and the other has none |
| response | the frontend requires a field the backend's type does not declare; one side is an array and the other is not; the frontend expects a body and the backend returns nothing |

A field the backend sends and the frontend ignores is not a difference.
That is ordinary.

Each call's `contract`:

```js
contract: {
  request:  { status: 'agree' | 'differ' | 'unread', extra: [...], missing: [...], optional: [...], why },
  response: { status: 'agree' | 'differ' | 'unread', missing: [...], shape, why },
}
```

The frontend model gets `contractMeta`, printed by `scan`:

```
contracts  requests 24 compared · 0 differ · 11 unread   responses 36 compared · 6 differ · 33 unread
```

And it gets a finding, `contract-drift`, one instance per call that
differs, listing what differs. It is **advisory** (`gate: false`): this is
drift between declared types, and the runtime may still work, as each of
the six above does. It is not a broken call. It is printed, and never fails
`check`.

### In a change

`stackCompare` (spec 13) gains `contractDrift`: the calls whose contract
differs at the head and either agreed (or did not exist) at the base. That
is drift the change introduced. `diff`'s stack section prints it after the
broken calls, and the workbench's change panel lists it under them.

### On the workbench

A request function's stud already lists each HTTP call and the endpoint it
reaches. Each call now shows its contract: ✓, or the fields that differ.

## Increments

Small commits, roughly one per pair of functions:

1. the shape reader: expressions, then named types
2. the frontend's declared body and expected response, recorded per call
3. the backend's declared body and response, per endpoint
4. compare, plus `contract` on each call, `contractMeta`, and the finding
5. the `scan` line
6. drift in `stackCompare`, then in `diff`
7. the workbench: the inspector, then the change panel
8. docs and results

## Acceptance

1. **The shape reader is tested on its own:** literals, named types,
   classes with `@IsOptional`, arrays, `Promise`, `Partial`, intersections,
   and a name defined twice (unread).
2. **On chronus:** the six response differences above, and no request
   differences. On omega, none.
3. **In a change:** a fixture PR that renames a DTO field on the backend
   only reports the request drift it causes. A PR that changes both sides
   together reports none.
4. **Existing behaviour:** the backend models of chronus and omega are
   unchanged, and `check` does not fail on `contract-drift`.

## Out of scope

- **Field types.** Names and optionality only, as above.
- **Nested shapes.** One level of fields. `checkItems: CheckItem[]` is a
  field, not a shape to descend into.
- **Query parameters and path parameter types.**
- **Shapes inferred from code** rather than declared: an untyped handler's
  return, or an untyped `res.data`. These are unread.

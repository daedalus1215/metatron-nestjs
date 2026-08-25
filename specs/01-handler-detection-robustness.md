---
title: Handler Detection Robustness
status: implemented
project: metatron-nestjs
location: specs/01-handler-detection-robustness.md
created: 2026-08-24
tags: [scanner, correctness, portability]
implemented: 2026-08-24
---

# Handler Detection Robustness

## Context

`src/scan.js:416` binds an HTTP route decorator to the method it decorates:

```js
const hm = after.match(/\n\s{2}(?:public\s+|private\s+)?(?:async\s+)?(\w+)\s*\(/);
```

`\s{2}` hardcodes **two-space indentation**. `after` is the entire remainder of
the file, and `String.prototype.match` without `/g` scans forward from wherever
it is until something matches — so on a four-space codebase the regex does not
fail, it **binds the route to a different method further down the file**.

Verified:

```
2-space :  findOne          <- correct
4-space :  legacyTwoSpace   <- a method 6 lines later, in another block
```

Everything downstream inherits the error: `handler`, `params`, `dto`, `returns`,
`body`, and the whole `flat` call trace are computed for the wrong method. The
traffic lens then draws a confident, fully-populated, wrong trace.

**Coverage does not catch this.** Coverage measures pattern classification only;
a project can report 100% classified and have every endpoint mis-bound. This is
the exact failure mode the coverage signal was introduced to prevent, in a place
coverage does not reach.

Chronus, kairos, nous and cereberus are all two-space, so this has never fired
here. It would fire on the first four-space codebase metatron is pointed at,
which makes it a direct threat to the one-shot bootstrap goal.

Two smaller defects in the same block:

- `src/scan.js:403` — `VERB_RE` covers `Get|Post|Put|Patch|Delete`. `@All`,
  `@Head` and `@Options` produce no endpoint at all.
- `src/scan.js:408` — the `@Controller` regex requires a quoted string, so the
  object form `@Controller({ path: 'notes' })` silently yields an empty prefix
  and every route in that controller is reported at the wrong path.

## Goal

Bind a route decorator to the method that actually follows it, independent of
indentation width, and fail loudly rather than silently when it cannot.

## Design

### Replace scanning with anchored forward parsing

The handler is not "the next thing that looks like a method somewhere below" —
it is **the first method declaration after the decorator**, skipping any further
decorators. Parse forward deterministically instead of regex-scanning:

1. From the end of the matched route decorator, walk forward.
2. Skip whitespace and comments (`//`, `/* */`).
3. If the next non-trivial token is `@`, consume that whole decorator —
   including a parenthesised argument, brace-matched so nested `(`/`)` in an
   object literal do not terminate early — and repeat from step 2.
4. Otherwise expect `[public|private|protected] [static] [async] <name>(` and
   take `<name>`.
5. If step 4 does not match, record **no endpoint** and push a diagnostic.

Indentation never enters the decision.

### Fail loudly

Add to the model a top-level `diagnostics` array:

```js
{ kind: 'handler-unresolved', file, decorator: '@Get(\':id\')', line }
```

The CLI prints a `!` warning when non-empty, next to coverage:

```
coverage    390/390 (100.0%)
endpoints   63 traced
diagnostics 2 route decorators could not be bound to a method   !
```

A route we cannot parse must be visible. Silently dropping it is how the current
bug hides.

### Widen the verb set and the controller prefix

- `VERB_RE` gains `All|Head|Options`. `@All` records verb `ALL`.
- `@Controller` accepts three forms: bare `@Controller()`, string
  `@Controller('notes')`, and object `@Controller({ path: 'notes' })`. Extract
  `path` from the object form; if a form is unrecognised, emit a
  `controller-prefix-unresolved` diagnostic rather than defaulting to `''`.

## Model changes

- `diagnostics: Diagnostic[]` — new top-level array, always present.
- `endpoints[].verb` may now be `ALL`, `HEAD`, `OPTIONS`.

No breaking change to existing consumers; adapters and templates ignore
`diagnostics` unless they opt in.

## Tests

A fixture directory `test/fixtures/indentation/` containing the same controller
written three ways — two-space, four-space, tab-indented — plus one using
`@Controller({ path })` and one with an interleaved `@ApiOperation({...})`
carrying a nested object literal. Assert all five resolve to the identical set
of `{ verb, route, handler }`.

Regression guard: assert that a four-space fixture whose file also contains a
later two-space block does **not** bind to the later method.

## Out of scope

- Route parameter type inference beyond what exists today.
- Nest's `@HostParam`, versioning, or route arrays (`@Get(['a', 'b'])`) — worth
  a diagnostic each, not handling.

## Acceptance

- The three-indentation fixture set yields identical endpoint sets.
- Re-running against Chronus produces the same 63 endpoints and 257 hops as
  today, proving the rewrite is behaviour-preserving on the current corpus.
- `diagnostics` is empty for all four existing projects, or every entry is
  explicable.

---

## Implementation notes (2026-08-24)

Landed in `src/scan.js`. `nextMethodAfter()`, `controllerPrefix()`, `routeArg()`
and `lineOf()` are module-level helpers next to the other parse primitives.

**Behaviour-preserving on the existing corpus.** Chronus produces the same 63
endpoints and 257 hops, and every endpoint payload is byte-identical to the
previous model. All four projects scan with zero diagnostics.

**The fixtures prove the bug.** Running `test/fixtures/indentation/` through the
old scanner and the new one:

```
OLD   FourSpaceController   GET /notes/:id#decoyTwoSpace | POST /notes#decoyTwoSpace
      (TabController, ObjectPrefixController, ExtraVerbsController: no endpoints at all)
      total 4 endpoints, 0 diagnostics

NEW   FourSpaceController   GET /notes/:id#findOne | POST /notes#create
      TabController         GET /notes/:id#findOne | POST /notes#create
      ObjectPrefixController GET /notes/:id#findOne | POST /notes#create
      ExtraVerbsController  ALL /probe/any | HEAD /probe/h | OPTIONS /probe/o
      total 11 endpoints, 2 diagnostics
```

The old scanner did not merely miss routes — it bound both four-space routes to
`decoyTwoSpace`, a method six lines below, and reported nothing wrong.

**Deviation from the spec:** an unbalanced route-decorator paren emits
`route-arg-unrecognised` rather than a distinct kind. Same category — an
argument we will not interpret — and it did not warrant a fourth kind.

`npm test` (`node --test test/*.test.js`) runs 8 assertions. This is the repo's
first test suite.


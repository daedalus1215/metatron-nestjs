# Spec 07 scratch — the tracer eats arrow properties

Status: decisions pending (Q7 / Q8 / Q9). Thinking doc, not a spec.
Caveman on: short sentences. Concrete.

## The bug in one picture

Kairos writes its services like this:

```ts
class MeetingService {
  startMeeting = async (userId: string) => {
    return this.loginTS.apply(...)   // the real work is in here
  }
}
```

Metatron looks for methods one way: **the name, then `(`.**

```
startMeeting(userId) {     <- name, then (    -> found
startMeeting = (userId) => <- name, then =    -> not found
```

Not found means the method does not exist. The chain ends there.
No error. No diagnostic. Silence.

What Kairos's map looks like today (measured on a live scan):

```
POST /auth/login
  -> AuthService.login        (depth 1)
  -> (nothing. the trail ends in the air)
```

What it should look like:

```
POST /auth/login
  -> AuthService.login            (depth 1)
  -> LoginTS.apply                (depth 2)
  -> UserRepository.findByEmail   (depth 3)
```

The numbers: 23 endpoints. 22 of them truncated. ~44+ hops never
reported. `diagnostics: {}` — empty. The tool is fully quiet about it.

Your other five projects: zero arrow-property files. The fix touches
nothing there. That is also the safety net: if their models change,
something went wrong.

## Q7 — how big is the fix. Three pieces.

### Piece A — teach the shape (the fix itself)

Three places in the scanner read method syntax with the same
"name then (" regex:

| place | job | today | after |
|---|---|---|---|
| `nextMethodAfter` | binds a route decorator to its handler | `name(`, `async name(`, decorated | + `name = (…) =>`, `name = async (…) =>` |
| `methodSig` | the signature shown on a trace hop | same | + same |
| `methodBody` | finds the body so the trace can walk its calls | same | + same |

One new regex alternative, three places. Finding the body's braces
reuses the brace-matching that already exists — the anchor just starts
at the `{` after `=>` instead of after `)`.

### Piece B — make the stops loud (the guarantee)

Today a trace can stop mid-chain three ways and say nothing:

1. **body not found** — the arrow case. Piece A fixes this specific
   one. The next unknown shape will hit this again.
2. **`this.x.y()` where `x` is not a constructor injection** — a class
   field or a local. Dropped.
3. **depth cap** — deeper than 5 hops. Cut.

Piece B adds one diagnostic kind for all three, in the same array the
port diagnostics already use:

```
{ kind: 'trace-stalled', file, method, depth,
  reason: 'body-not-found' | 'dep-not-injected' | 'depth-cap' }
```

There is a line in the scanner that says, in effect: *a port we cannot
follow must say so rather than end a trace unannounced.* Piece B
extends that promise from the entry to the middle of the chain. This
is the piece that makes the next unknown style a visible "I stopped
here, and why" instead of another silent amputation.

### Piece C — the invented hops (the quirk)

When an entry resolves nothing (depth 0), the scanner today paints one
fake hop per injected dependency: `{ cls: 'X', method: null,
inferred: true }`. The view gets something to draw. The model already
flags it `inferred` — the tool admits it in the data.

Options: keep it / kill it and diagnose instead / keep but also
diagnose.

My read: **keep it.** It is already admitted in the model. Killing it
changes five healthy projects' models to fix nothing measurable. Out of
scope for this spec.

**Q7 recommendation: A + B. Leave C alone.**

## Q8 — how much syntax do the regexes learn

Census of all six backends — what is actually in the wild:

| shape | in the wild? | learn? | cost |
|---|---|---|---|
| `name = (…) => {}` | yes — Kairos, 37 files | yes | the fix itself |
| `name = async (…) => {}` | yes — Kairos | yes | the fix itself |
| `private name = (…) => {}` | zero today | **yes (recommend)** | one regex branch, one fixture line |
| `getter name() {}` | zero | no | — |
| `name = someOtherFn(...)` | zero | no — trap: not a method | — |

Why learn `private` when it is zero today: a codebase that adds
`private` next year should not silently regress to amputation. One
branch buys that. Getters: none seen, none demanded — and a getter is a
different animal (no `this.x()` walk in the same shape), so "no" is a
decision, not a shrug.

The second fork — **scoping.** The regexes are line-anchored but not
class-scoped. They do not know where the class starts and ends. The
false-match scenario:

```ts
class A { apply() { this.repo.save(...) } }
class B { apply = () => { ... } }
```

Two classes in one file, both with a method called `apply`. A trace
asking for `apply` could pick up the wrong body.

How likely: low. NestJS convention is one class per file. All six
backends follow it.

Options: (1) build class-body scoping — new parsing machinery;
(2) accept it and write it down as a known limit in the spec.

**Q8 recommendation: learn `private`. Accept scoping. Document it.**
House rule: don't build what no fixture needs.

## Q9 — where the new diagnostics show up

Today: every diagnostic (port-ambiguous, handler-unresolved, …) lives
in the model JSON only. Verified: zero templates render any
diagnostic. Nobody has ever seen one in a browser.

- **Option 1 — model only.** The new `trace-stalled` joins the others:
  in the JSON, asserted by tests.
- **Option 2 — model + first view surfacing.** A footer line in the
  traffic view: "N traces could not be followed."

Cost of option 2: about ten lines of template script plus a test.

Why I still pick option 1: it is a view decision wearing a
correctness spec's clothes. And after the fix, Kairos's stall count is
zero — the footer would have nothing to say. If a project ever lights
it up in practice, the footer gets its own small spec with the view
work.

**Q9 recommendation: model only.**

## What "done" looks like (acceptance preview)

- Kairos: 22 of 23 traces reach the repository layer. Hop count goes
  from 37 to roughly 80. Diagnostics stay at zero — nothing stops.
- The other five projects: models byte-identical to main. Zero arrow
  properties means nothing can change.
- New fixture: a mini NestJS project with arrow-property services,
  including one `private` variant and one shape (a getter) that must
  produce a `trace-stalled` diagnostic. House rule: no new parsing
  without a fixture.
- `metatron diff` on a Kairos commit then reports endpoints affected
  through the whole chain, not just the first hop.

## The three decisions

1. **Q7** — A + B, leave C?
2. **Q8** — learn `private`, accept + document scoping?
3. **Q9** — model only?

# metatron

Point it at a NestJS backend and get seven interactive views of its architecture,
a list of every place the code breaks its own rules, and a live workbench where
you can pick up any class, see what it is snapped into, and replay a PR against
the code it touches.

Nothing in the output is drawn or written by hand. Every box is a directory that
exists, every line is an `import` a file actually writes, and every sentence is
assembled from what the scan found.

---

## Start here

**1. Install it.** Pick one:

```bash
# just this project
npm i -D github:daedalus1215/metatron-nestjs

# or once, for every project on this machine
git clone https://github.com/daedalus1215/metatron-nestjs
cd metatron-nestjs && npm link
```

**2. Add one file** next to the `src/` you want scanned. For a `backend/src`
layout that means `backend/arch.config.js`:

```js
module.exports = {
  extends: 'nestjs',
  root: 'src',
};
```

The project name is taken from the folder. Set `name` only if you want to
override it — and if you copy a config between projects, metatron warns when the
name no longer matches where it sits.

**3. Run it.**

```bash
metatron            # or `npx metatron` if you installed it into the project
```

**4. Open the result.**

```bash
open .metatron/index.html
```

That's it. Seven views, self-contained HTML, no server. You don't need an agent or
any login to look at them — they're just files.

You can also run it without `cd`-ing anywhere:

```bash
metatron ~/code/my-api/backend
```

---

## If it says coverage is low

This is the only step that needs your judgement. metatron prints how much of
your code it understood:

```
coverage 119/121 (98.3%)          good — carry on
coverage 125/142 (88.0%)  !       needs a few more lines
```

When it warns, it tells you exactly what it didn't recognise:

```
  17 files matched no pattern. Add them to `addPatterns` in arch.config.js:
    .exception.ts   4x   e.g. articles/domain/exceptions/no-links-found.exception.ts
    .validator.ts   3x   e.g. articles/domain/services/non-empty.validator.ts
```

Copy those into your config, saying which layer each belongs to:

```js
addPatterns: [
  { id: 'exception', tier: 'Contract',           test: /\.exception\.ts$/ },
  { id: 'validator', tier: 'Transaction Script', test: /\.validator\.ts$/ },
],
```

Re-run. Two or three rounds gets most projects past 95%.

**Why this matters:** a tool that quietly files half your code under "other" and
then draws a confident picture of it is worse than one that fails. The number is
printed first so you always know whether to trust the rest.

---

## If it prints diagnostics

Coverage measures classification. It says nothing about whether a route was
parsed correctly — so parsing failures get their own line:

```
  2 scan diagnostics  !
    handler-unresolved  1x
      notes/notes.controller.ts:41  @Get('lost') is not followed by a method declaration
    route-arg-unrecognised  1x
      notes/notes.controller.ts:52  @Get(['a', 'b']) is not a plain string - endpoint skipped
```

Each one is a route metatron chose **not** to report rather than guess at. An
empty list means every route decorator in the codebase bound cleanly.

If you see `controller-prefix-unresolved`, the `@Controller()` argument is a
form metatron does not read, and routes in that file are reported relative to
`/` instead of the real prefix.

Two kinds concern ports. A call through `@Inject(TOKEN)` is followed into the
class a module binds to that token with `useClass` or `useExisting`. When
metatron cannot say which class that is, the trace stops at the interface and a
diagnostic says why:

```
    port-unbound  1x
      things/domain/services/thing.service.ts:21  no module provides UNBOUND_PORT — trace stops at UnboundPort
```

`port-unbound` means the token is provided by `useFactory` (a factory can return
anything, so it is not followed), is bound to a class outside the scanned tree,
or is declared in the tree and provided nowhere. `port-ambiguous` means two
modules bind the same token to different classes. Nest settles that by module
scope, which metatron does not model, so it declines to pick.

A third kind concerns the middle of a trace. A call on `this.x` is followed
when `x` is injected, or is a field typed as, or created with `new`, a class
in the tree. A call on a field holding a library object (`this.logger.log`,
`this.cache.get` on a `Map`) is a library call, not a gap, and is passed over
quietly. When a call cannot be followed, the hop stops and a `trace-stalled`
diagnostic says where and why:

- the method's body is in a shape metatron does not read
- `this.x` is neither injected nor declared (`dep-not-injected`)
- `this.x` is a field whose type metatron cannot read, such as an object
  literal (`field-unknown`)
- the trace is deeper than five classes (`depth-cap`)

A trace that ends is either short or cut; the diagnostics tell which.

A fourth kind concerns the wiring model behind the workbench. Every
constructor parameter of a class Nest builds is a socket, and each one is
followed to the class that fills it. One that cannot be followed is a
`socket-unresolved` diagnostic that names the parameter and why: no class of
that name in the tree, a class from a package metatron does not know, or a
parameter it cannot read. The count is on the `wiring` line of the scan.

---

## Holding the line

metatron observes by default. To make it *enforce*, record today's violations as
accepted and fail the build when a new one appears:

```bash
metatron baseline     # writes arch.baseline.json
metatron check        # exit 0 clean, 1 new violations, 2 tool/config error
```

```
metatron check · chronus

  new violations        1
    action>repository     notes/apps/actions/log-time/log-time.action.ts
                          -> time-tracks/infra/repositories/time-track.repository.ts

  fixed since baseline  2

  known, unchanged      42

FAIL — 1 new violation. Fix it, or run `metatron baseline --update` to accept it.
```

The baseline sits **beside `arch.config.js`**, not in the output directory —
output is generated and usually gitignored, and a ratchet that is not committed
cannot hold a line. Commit it.

Each violation is stored by a fingerprint of `rule|from|to`, so `check` can name
the offender and catch a swap — one violation fixed and another introduced in
the same change, which a per-rule count nets to zero and passes. A rename shows
up as one removed plus one added, which is noise, but metatron cannot know a
rename preserved intent and guessing would let a real violation ride in on one.

Add a `note` to any entry to record *why* it is tolerated. `--update` preserves
notes; if a noted violation no longer exists, its note goes with it and the tool
says so.

```json
"a3f19c4b2e01": {
  "rule": "action>repository",
  "from": "notes/apps/actions/create-note/create-note.action.ts",
  "to": "notes/infra/repositories/note.repository.ts",
  "note": "legacy, pre-dates the aggregator"
}
```

Adopting mid-stream on a codebase you do not want to clean up first:

```bash
metatron check --allow-new 3      # ratchet the number down over time
metatron check --rule orphans     # or gate one rule, everything else advisory
```

Violations that are **fixed** are reported but never removed automatically. A
scan that temporarily fails to parse a file would otherwise quietly retire a
real debt, and it would come back later as a "new" violation with no history.

Aggregate findings — `dag` reports cycle totals, `app-apps` reports a spelling
split — carry `gate: false` and never become violations. They are worth printing
and meaningless to ratchet. `metatron baseline` lists which ones are excluded.

---

## Blast radius

`check` answers "did the code break the rules?" `diff` answers "what does this
change touch?":

```bash
metatron diff               # <merge-base with the default branch>...HEAD
metatron diff main...HEAD   # an explicit range
metatron diff --staged      # what is about to be committed
```

```
metatron · chronus · acf6126~1...acf6126
6 files changed (1 added, 5 modified)

blast radius: 24 direct dependents, 51 transitively reachable (14.1% of 362 files)

endpoints affected: 18
  GET /check-items/items/:id
  GET /notes/search
  … (16 more)

architecture: no arch.baseline.json — no delta

worth a look
  `notes/domain/services/note.service.ts` is hotspot #9 of 362 (12 commits, 14 dependents)
  `check-items.repository.ts` co-changes with `create-check-item.transaction.script.ts` 30% of the time — not in this diff
  4 of 5 changed source files have no test

focus: .metatron/city.html?focus=check-items/…,notes/domain/services/note.service.ts,…
```

The range is local git only: it works offline, on any branch, before a PR
exists — which is when the answer is most useful. The report goes to stdout
and exits 0; nothing is posted anywhere, and the exit code is not a gate a
pipeline should branch on. `--format=markdown` is pasteable into a PR
description, `--json` is for tooling. The report ends with a `focus:` line:
a URL that opens the city view with only the changed files' towers lit, for
the files that have towers. If the views have not been built it says
`build the view first (metatron views)` instead of printing a dead link.

Three things the report refuses to do:

- **Count imports as calls.** An endpoint is listed as affected only when a
  changed file sits in its traced call path or owns it. A changed repository
  no request actually reaches through the traced path is not an affected
  endpoint.
- **Report a deleted file as having no impact.** A deleted file has no node in
  the current model, so `diff` scans twice, once at each end of the range,
  with the file contents resolved from git objects. The head is the range's
  head commit (or the index, with `--staged`), not the working tree: a branch
  you have not checked out is measured as it is on that branch, and uncommitted
  edits never leak into a committed range. Nothing is checked out or stashed,
  so the command is safe to run mid-edit. A rename is
  one change, not a deletion plus an addition: a violation that merely moved
  with a renamed file is folded, not reported as one new and one fixed.
- **Blame the diff for a new violation in untouched code.** That is labelled a
  scan difference, not the diff's doing.

---

## Workbench

```bash
metatron serve              # http://127.0.0.1:4477/
metatron serve --port 5000 --no-watch
```

The views above are pictures. The workbench is somewhere to pick the code
up and turn it over. Pick a class and it is drawn as a brick in a stack:

- the bricks it sits on (what its constructor injects) are below it
- the bricks that sit on it are above it
- rows are tiers, so a request reads top to bottom

The parts of a brick are its **studs** and **sockets**:

- **Studs** are its public methods, along the top edge. The fill shows what
  calls each one: another brick, an HTTP route, the framework (`@OnEvent`,
  `onModuleInit`, …), or nothing metatron can see.
- **Sockets** are its constructor parameters, along the bottom edge.

Hover a stud to light every call that grips it. Hover a socket to see which
studs it grips. Click anything to read its source, where each call site
links to the brick it lands in.

It is a local server, bound to `127.0.0.1` only, because it serves source
code. It re-scans when you save a `.ts` file, and the open page redraws
with your place kept. The data comes from the wiring model (`bricks`,
`wires`, `calls` in `model.json`). `metatron scan` prints its coverage line:

```
wiring 271/271 sockets resolved (100.0%) · 30 framework · 0 unresolved
studs 356 · 255 gripped by a brick · 63 by a route · 10 by the framework · 28 unseen
```

An `unseen` stud is a public method no call metatron can read reaches. It
is a lead, not a verdict: callers outside the tree, and call shapes the
scan does not read, are invisible to it.

### A change on the workbench

Type a range (`main...feat/x`), a PR (`#12`), one or more commits
(`a1b2c3d, e4f5a6b`), or nothing (work in progress) into the bar. A set of
commits is shown on its own, applied in order onto the parent of the oldest,
and nothing is written to the repository. A commit that needs one you left
out is refused, by name. The bench switches to a **change map**: every brick the change
added or edited, and both ends of every connection it made, in tier rows.
New connections are coloured by which of their ends already existed:

| | |
|---|---|
| **attachment** | new code plugging into an existing brick |
| **graft** | an existing brick changed to reach new code |
| **rewire** | two existing bricks newly connected: the old code's shape moved |
| **detached** | a connection the change removed, drawn dashed red |

A removed brick is drawn as a ghost, dashed and struck through, as it was
before the change. Click it to read its source as it was.

The panel on the left leads with where the change meets the codebase,
grouped by the existing brick. A range with several commits gets a scrubber
that replays it one commit at a time.

The head of a range is read from git objects, so a PR can be reviewed from
any branch without checking it out. `#12` asks `gh` for the PR's commits. If
the head commit is not local, the workbench prints the `git fetch` to run and
does not fetch it for you. `metatron diff` ends with a link to the same
range on the workbench.

## On a new machine

```bash
git clone https://github.com/daedalus1215/metatron-nestjs
cd metatron-nestjs
npm link          # puts `metatron` on your PATH
metatron skill    # lets agent sessions use it without being told how
```

`metatron skill` copies the bundled skill to
`~/.agents/skills/metatron/SKILL.md`. After that, a new agent session in **any**
repo already knows this tool exists — you can say "set up metatron here" or "map
this backend" and it knows the whole procedure. Without it, you'd have to say
"read the README in metatron-nestjs and use it", which also works.

It's a command rather than something `npm install` does automatically, because
installing a package shouldn't write into your home directory.

Needs Node 18+. Chromium is optional, only for checking a view renders before
you share it.

If `metatron --help` prints something else, another tool of the same name is
earlier on your PATH (the Rust sibling, `metatron-rust`, installs one through
cargo). Run this one by its path, or give it an alias:

```bash
alias mtn='node ~/path/to/metatron-nestjs/bin/metatron.js'
```

---

## What you get

| view | answers |
|------|---------|
| `atlas` | Where does everything live, and which of its own rules does the code break? |
| `traffic` | What happens when a request arrives? Every endpoint as an animated trace with the real payload at each hop. Full screen and three row densities, for APIs with a lot of routes. |
| `city` | What shape is each module, and can I walk around it? One tower per module, one floor per directory, with a projection toggle, and a `?focus=` URL that lights a set of towers and ghosts the rest — see below. |
| `layers` | Does the layering hold? Every file on the plane of its tier — a link that skips a plane is a violation. |
| `schema` | What does the data look like? Entities, columns, and references — including the ones the ORM never hears about. |
| `hotspots` | Where does refactoring pay? Every file plotted by change frequency against how much depends on it. Files with no test carry a dashed ring, so the corner doubles as a test backlog. Needs git history. |
| `coupling` | Which files change together without referencing each other? A co-change matrix crossed with the import graph — the cells it cannot explain are duplicated rules or missing abstractions. Needs git history. |

### Isometric or perspective?

The `city` view offers both, and the difference is not cosmetic.

**Isometric** (the default) is a parallel projection: distance changes where a
tower is drawn, never how big. Four identical towers at four different depths all
draw the same height. Since a tower's height *is* how many layers a module has,
**you can compare any two by eye and the answer is right**.

**Perspective** divides by depth, the way a camera does. Nearer towers are drawn
larger — a module at the front can look taller than a taller one at the back. It
feels like standing in the city, which is better for exploring, and useless for
comparing.

```
parallel      s = focal / distance-to-aim-point     scale is constant
perspective   s = focal / depth-of-this-point       scale falls off with depth
```

Measured on a real project: in isometric every tower draws at exactly 5.105
pixels per unit of height; in perspective that ranges from 4.13 to 5.25 across
the same towers.

### Implicit references

Declaring a TypeORM relation across a bounded context couples the two contexts,
so plenty of codebases store a bare `noteId` column instead. That reference is
real — application code has to honour it — but the ORM cannot see it, the
database has no constraint, and no schema tool will draw it.

The `schema` view infers those from column names: a column ending `Id` or `_id`
whose stem matches an entity class or table name. `parentId` reads as a
self-reference. A column matching no entity is left alone rather than guessed at.

On one real backend that turns 4 declared relations into 14 real ones, 10 of
which cross a context boundary.

## Churn and hotspots

If the scanned tree is inside a git repository, metatron reads `git log
--numstat` and records commits, lines added and removed, first and last touch,
and distinct authors per file. Set `churnSince: '2 years ago'` in the config to
bound it. Outside a repo it is skipped silently — `churnMeta.available` says
which.

The `hotspots` finding ranks files by commits multiplied by dependents. High on
both is where refactoring pays for itself and where a mistake travels furthest.

Test presence is crossed with the same score. A file that changes often, is
widely depended on, and has no test is `untested-risk`; the `test-ratio`
finding reports tested/total per pattern. This is **presence, not quality** —
a file with one smoke test counts as tested.

The test locator is configurable (`testLocators`) and self-checking. The
default looks in a `__specs__/` folder beside the source (`foo.spec.ts` and
`foo.integration.spec.ts`), then for a sibling `foo.spec.ts`, then in a
mirrored `test/` tree. A source claims every spec it finds, so a unit spec and
an integration spec both count. Every spec
file must be claimed by exactly one source file; when too many are unmatched
the locator does not fit the project and both findings suppress themselves
rather than report a confident wrong number. The CLI says so.

## Coupling

Every graph metatron draws comes from `import` statements, and there is a
definition of coupling that is structurally blind to it: **two files with no
import relationship that keep changing together.** That is usually a missing
abstraction, a duplicated invariant, or shotgun surgery — it can only be found
by reading the history.

`coupling` keeps the per-commit file set (the co-change signal `hotspots`
discarded), scores each pair by Jaccard degree over the trusted commits, and
crosses the result against the import graph. Two guards keep the numbers
honest: commits touching more than `couplingMaxFiles` files (25) are mass
renames or formatting sweeps and are ignored — the count is reported — and a
pair is only eligible when both files changed at least `couplingMinChanges`
times (5). The `logical-coupling` finding reports the pairs that co-change
above 60% **with no import edge between them**: the ones worth reading.

The lens is a dependency structure matrix: modules on both axes by default,
files on toggle, click a block to zoom, a threshold slider, and the import
overlay so the unexplained cells stand out. Outside a repo it degrades the way
churn does.

## Commands

```bash
metatron [path]           scan and build everything
metatron scan [path]      model only, no views
metatron views [path]     rebuild views from the cached model
metatron views layers     just one view
metatron baseline         record today's violations as accepted
metatron baseline --update   rewrite it, keeping hand-written notes
metatron check            fail if new violations appeared
metatron diff             what does this change touch? (report on stdout)
metatron diff main...HEAD   an explicit range
metatron diff --staged      what is about to be committed
metatron serve            the workbench (local server, live re-scan)
metatron skill            install the agent skill
metatron --help
```

Working on metatron itself: `npm test` runs the fixture suite.

---

# Reference

## Config

| key | meaning |
|-----|---------|
| `extends` | base profile. `nestjs` is the only one so far. |
| `root` | scanned directory, relative to the config file. |
| `name` | shown in the views. Defaults to the project folder, skipping generic wrappers like `backend/`. |
| `outDir` | where output lands. Default `.metatron`. |
| `addPatterns` | patterns *prepended* to the profile — refine without restating everything. |
| `patterns` | replace the profile's list wholesale. |
| `tiers` | the architectural layers, ordered as a request travels. |
| `flow` | the intended call path. Violation rules are derived from it. |
| `flowAliases` | other patterns that count as the same station. |
| `forbidden` | imports that must never go a given direction. |
| `noSameLevel` | patterns that must not inject their own kind. |
| `infraModules` | modules that are plumbing, not bounded contexts. |
| `crossDomainGateways` | the only patterns a cross-context import may land on. |
| `moduleOf` | `(rel) => string`, if the first path segment isn't the module. |
| `churnSince` | git revision-range date, e.g. `'2 years ago'`, to bound history. |
| `testLocators` | ordered `(relPath) => relPath` strategies that locate a source file's tests. A source claims every spec any of them finds; the first is the one reported. See Churn and hotspots. |
| `couplingMaxFiles` | commits touching more files than this are ignored for co-change — a 200-file rename couples everything to everything. Default 25. |
| `couplingMinChanges` | per-file support floor before a pair is eligible. Default 5. |
| `couplingMinDegree` | Jaccard floor for a pair to enter the model; the lens slider opens here. Default 0.3. |

**Declare the flow, get the rules.** Write

```js
flow: ['action', 'service', 'transaction-script', 'repository'],
```

and metatron derives the violations: jumping one station is a warning, two or
more is critical. You never hand-list them.

**Shape beats location.** A `*.converter.ts` inside a services folder is a
converter. Patterns are tested in order, so put shape-specific names first —
including in `addPatterns`, which prepends.

## Adding a view

One file: `templates/<name>.html`, containing exactly one `__DATA__` token
inside a JSON script tag.

```html
<!-- metatron: One line describing what this view answers. -->
<title>{{project}} Whatever</title>
<script id="data" type="application/json">__DATA__</script>
<script>
  var D = JSON.parse(document.getElementById('data').textContent);
</script>
```

It's picked up automatically. Tokens: `{{project}}`, `{{projectId}}`, `{{root}}`,
`{{date}}`, `{{files}}`, `{{imports}}`, `{{endpoints}}`, `{{modules}}`.

Add `adapters/<name>.js` exporting `(model) => object` to trim the payload —
worth doing, it took one view from 453 KB to 84 KB. To see what a template
actually reads:

```bash
grep -oE '\bD\.[a-zA-Z_]+' templates/<name>.html | sort -u
```

**Never type a finding into a template.** Use `<p data-narr="layering"></p>` and
the sentence is generated at build time; slots with nothing to say are removed.
Available: `scale`, `flow`, `layering`, `crossDomain`, `absent`, `skyline`,
`cycles`, `upheld`, `deviations`, `endpoints`, `provenance`, `caveats`. Add more
in `src/narrate.js`.

This rule exists because the first version had its findings typed into the HTML.
The charts updated for a new project and the paragraphs kept confidently
describing the old one.

## Checking a view renders

```bash
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --virtual-time-budget=9000 --window-size=1600,1050 \
  --screenshot=shot.png "file://$PWD/.metatron/layers.html"
```

For detail, add `--force-device-scale-factor=2` and crop with `magick`; for the
dark theme add `--force-dark-mode --blink-settings=preferredColorScheme=0`
(headless defaults to dark, so pass
`--blink-settings=preferredColorScheme=1` to force light).

The large `--virtual-time-budget` is required — the canvas views draw on
`requestAnimationFrame`, and a short budget screenshots a blank canvas. Static
checks won't catch mirrored text, washed-out blends, clipped content or missing
glyphs. Look at the picture.

The workbench cannot be checked this way. Its live-update stream never lets
the page go idle, so `--screenshot` waits forever. Drive Chromium over the
DevTools protocol instead (`--remote-debugging-port`): navigate, wait, then
`Page.captureScreenshot`. That also gives you the console errors.

## What it can't see

- **Imports are not calls.** The graphs count imports, type-only ones included.
  Only `endpoints[].flat` and the wiring model's `calls` follow real calls
  through method bodies: `this.x.method(` through an injected dependency, a
  function imported from a util file, and `Cls.method(` on a static.
- **Calls in other shapes are invisible.** A destructured dependency
  (`const { repo } = this`), a call through a local alias
  (`const r = this.repo`), a subclass calling what its parent injected, and
  callers outside the scanned tree reach nothing. (`this.x?.method(` and calls
  through typed fields are followed.) That is why a public method no call reaches is
  `unseen` on the workbench, never "dead".
- **Ports are followed only as far as a module file says.** A call through
  `@Inject(TOKEN)` continues into the class a module binds with `useClass` or
  `useExisting`, and the hop keeps the port's name so the indirection stays
  visible. `useFactory`, a token bound differently in two modules, and an
  in-tree token nobody provides are listed in `diagnostics` rather than guessed
  at. Module scoping (`imports`/`exports`) and dynamic modules
  (`forRootAsync()`) are not modelled, and no import edge is invented for a
  binding.
- **Structure, not quality.** It knows where a transaction script sits and what
  it touches, never whether it's any good.
- **Parsing, not compiling.** Route decorators bind to methods by walking
  forward through decorators and comments, and classes, members and functions
  are read by a brace-matching walker that skips strings, comments and regex
  literals; there is no TypeScript AST. Anything that fails to bind is listed in
  `diagnostics` rather than dropped. Inheritance is recorded (`extends`) but
  not followed: a subclass does not inherit its parent's sockets.
- **Filenames, not ASTs.** Suits projects whose conventions live in filenames. A
  codebase carrying its architecture in decorators needs a different front end.

## Model

`.metatron/model.json`:

`stats` · `coverage` · `tiers` · `flow` · `skipRules` · `nodes` / `edges` (folder
graph) · `fileNodes` / `fileLinks` (file graph, links tagged with the rule they
break) · `modules`, `domainModules`, `platformModules` · `allModuleEdges`,
`domainEdges` · `cycles` (Tarjan SCCs with sanctioned carve-outs applied
progressively) · `crossDomain` · `ports` · `endpoints` · `shape` · `findings` · `dataModel` (entities, columns, declared and inferred
relations) · `orphans` · `churn` / `churnMeta` · `diagnostics` (routes that
could not be parsed, and ports and mid-trace stops that could not be followed,
rather than silently dropped) · `bindings` (every `provide:` in a module file
and the class it binds;
a trace hop that crossed one carries `viaPort`, `token` and `boundIn`) ·
`violations` (warn findings flattened one per instance, each with a stable
fingerprint) · `tests` (each source file's spec, and the specs no source
claims) · `coupling` (co-change pairs) · `bricks` (one per class, util file,
port or script: its `sockets`, the constructor parameters with where each is
resolved; its `studs`, the public methods with their `grip`; and its
`internals`, each with a line range) · `wires` (injection edges between bricks)
· `calls` (every call site from one brick into another, with its line) ·
`wiringMeta` (the `wiring` and `studs` coverage counts).

## Prior art

Software cities go back to Wettel and Lanza's CodeCity (2007). "Fitness
functions" is from *Building Evolutionary Architectures*. The stacked-plane view
borrows its geometry from Purdue-model ICS diagrams. What's here is the coupling:
your rules, your code, measured on every run, rendered seven ways.

MIT.

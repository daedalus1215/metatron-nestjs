# metatron

Point it at a NestJS backend and get five interactive views of its architecture,
plus a list of every place the code breaks its own rules.

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

That's it. Five views, self-contained HTML, no server. You don't need Claude or
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

## On a new machine

```bash
git clone https://github.com/daedalus1215/metatron-nestjs
cd metatron-nestjs
npm link          # puts `metatron` on your PATH
metatron skill    # lets Claude sessions use it without being told how
```

`metatron skill` copies the bundled skill to
`~/.claude/skills/metatron/SKILL.md`. After that, a new Claude session in **any**
repo already knows this tool exists — you can say "set up metatron here" or "map
this backend" and it knows the whole procedure. Without it, you'd have to say
"read the README in metatron-nestjs and use it", which also works.

It's a command rather than something `npm install` does automatically, because
installing a package shouldn't write into your home directory.

Needs Node 18+. Chromium is optional, only for checking a view renders before
you share it.

---

## What you get

| view | answers |
|------|---------|
| `atlas` | Where does everything live, and which of its own rules does the code break? |
| `traffic` | What happens when a request arrives? Every endpoint as an animated trace with the real payload at each hop. |
| `isometric` | What shape is each module? One tower per module, one floor per directory. |
| `flyover` | Let me walk around it. Fly to any module; copy a text digest to paste into a chat. |
| `layers` | Does the layering hold? Every file on the plane of its tier — a link that skips a plane is a violation. |

## Commands

```bash
metatron [path]           scan and build everything
metatron scan [path]      model only, no views
metatron views [path]     rebuild views from the cached model
metatron views layers     just one view
metatron skill            install the Claude skill
metatron --help
```

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

The large `--virtual-time-budget` is required — the canvas views draw on
`requestAnimationFrame`, and a short budget screenshots a blank canvas. Static
checks won't catch mirrored text, washed-out blends, clipped content or missing
glyphs. Look at the picture.

## What it can't see

- **Imports are not calls.** The graphs count imports, type-only ones included.
  Only `endpoints[].flat` follows real `this.x.y()` chains through method bodies.
- **DI tokens are invisible.** Anything Nest resolves through a string token
  instead of an imported symbol leaves no edge, so coupling is understated.
- **Structure, not quality.** It knows where a transaction script sits and what
  it touches, never whether it's any good.
- **Filenames, not ASTs.** Suits projects whose conventions live in filenames. A
  codebase carrying its architecture in decorators needs a different front end.

## Model

`.metatron/model.json`:

`stats` · `coverage` · `tiers` · `flow` · `skipRules` · `nodes` / `edges` (folder
graph) · `fileNodes` / `fileLinks` (file graph, links tagged with the rule they
break) · `modules`, `domainModules`, `platformModules` · `allModuleEdges`,
`domainEdges` · `cycles` (Tarjan SCCs with sanctioned carve-outs applied
progressively) · `crossDomain` · `ports` · `endpoints` · `shape` · `findings`.

## Prior art

Software cities go back to Wettel and Lanza's CodeCity (2007). "Fitness
functions" is from *Building Evolutionary Architectures*. The stacked-plane view
borrows its geometry from Purdue-model ICS diagrams. What's here is the coupling:
your rules, your code, measured on every run, rendered five ways.

MIT.

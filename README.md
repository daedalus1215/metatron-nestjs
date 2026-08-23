# metatron

Compile a NestJS/TypeScript backend into a measured architecture model, then look
at it through interchangeable visual lenses.

Your architecture document says what the code *should* look like. metatron
measures what it *does* look like, and renders the difference. Nothing in the
output is drawn or written by hand — every box is a directory that exists, every
line is an `import` a file actually writes, and every sentence is assembled from
what the scan found.

```bash
npx metatron              # scan, build every lens, write an index
open .metatron/index.html
```

## Install

```bash
npm i -D github:daedalus1215/metatron-nestjs
```

Then a config at the root of the package you want to scan:

```js
// arch.config.js
module.exports = {
  extends: 'nestjs',
  name: 'my-api',
  root: 'src',
};
```

That is usually the whole config. Run `npx metatron` and read the coverage line.

### On a new machine

```bash
git clone https://github.com/daedalus1215/metatron-nestjs
cd metatron-nestjs && npm link      # puts `metatron` on PATH
metatron skill                      # teach Claude sessions about it
```

`npm link` is optional — `npm i -D github:daedalus1215/metatron-nestjs` inside a
project works too, and `npx metatron` then resolves. `metatron skill` copies the
bundled skill to `~/.claude/skills/metatron/SKILL.md` so a Claude session in any
repo knows the tool exists and how to bootstrap it. It is a deliberate command
rather than a postinstall hook: nothing should write into your home directory as
a side effect of `npm install`.

Requirements: Node 18+. Chromium is optional and only used for verifying a lens
renders before you share it.

## Coverage is the honesty signal

```
metatron · nous
  142 files · 345 imports · 71 directories · 14 modules
  28 endpoints · 95 traced hops
  6 layer-skipping links · 6 deviations · 1 rules upheld
  coverage 137/142 (96.5%)
```

`coverage` is the share of files that matched a configured pattern. Below 90% it
warns and prints the unmatched suffixes so you know exactly what to add:

```
  17 files matched no pattern. Add them to `addPatterns` in arch.config.js:
    .exception.ts   4x   e.g. articles/domain/exceptions/no-article-links-found.exception.ts
    .validator.ts   3x   e.g. articles/domain/services/validators/non-empty.validator.ts
```

```js
addPatterns: [
  { id: 'exception', tier: 'Contract',           test: /\.exception\.ts$/ },
  { id: 'validator', tier: 'Transaction Script', test: /\.validator\.ts$/ },
],
```

A tool that quietly classifies half your code as "other" and then draws a
confident picture of it is worse than one that fails. This is why the number is
printed first.

## Config

| key | meaning |
|-----|---------|
| `extends` | base profile. `nestjs` is the only one so far. |
| `root` | scanned directory, relative to the config file. |
| `name` | shown in the lenses. Defaults to the directory name. |
| `outDir` | where the model and lenses land. Default `.metatron`. |
| `addPatterns` | patterns *prepended* to the profile — refine without restating. |
| `patterns` | replace the profile's list wholesale. |
| `tiers` | the architectural layers, ordered as a request travels. |
| `flow` | the intended call path. Skip rules are derived from it. |
| `flowAliases` | other patterns that count as the same station. |
| `forbidden` | imports that must never go a given direction. |
| `noSameLevel` | patterns that must not inject their own kind. |
| `infraModules` | modules that are infrastructure, not bounded contexts. |
| `crossDomainGateways` | the only patterns a cross-context import may land on. |
| `moduleOf` | `(rel) => string`, if the first path segment is not the module. |

**Shape beats location.** A `*.converter.ts` inside a services folder is a
converter. Patterns are tested in order, so put shape-specific names first —
including in `addPatterns`, which prepends.

**Declare the flow, get the rules.** Write

```js
flow: ['action', 'service', 'transaction-script', 'repository'],
```

and metatron derives the violations: an import that jumps one station is a
warning, two or more is critical. You do not hand-list them.

## Lenses

| lens | answers |
|------|---------|
| `atlas` | Where does everything live, and which of its own rules does the code break? |
| `traffic` | What happens when a request arrives? Every endpoint as an animated trace with the real payload at each hop. |
| `isometric` | What shape is each module? One tower per module, one floor per directory, 2:1 axonometric. |
| `flyover` | Let me walk around it. Perspective camera, fly to any module, copyable digest for pasting to an LLM. |
| `layers` | Does the layering hold? Every file on the plane of its tier — a link that skips a plane is a violation. |

Each output is a single self-contained HTML file. No server, no CDN, no build
step. Open it, or publish it wherever you like.

## Adding a lens

One file. `templates/<name>.html`, containing exactly one `__DATA__` token inside
a JSON script tag:

```html
<!-- metatron: One line describing what this lens answers. -->
<title>{{project}} Whatever</title>
<script id="data" type="application/json">__DATA__</script>
<script>
  var D = JSON.parse(document.getElementById('data').textContent);
</script>
```

It is picked up automatically. Available tokens: `{{project}}`, `{{projectId}}`,
`{{date}}`, `{{files}}`, `{{imports}}`, `{{endpoints}}`, `{{modules}}`.

Add `adapters/<name>.js` exporting `(model) => object` if the lens wants a
smaller payload — worth doing, it took one lens from 453 KB to 84 KB:

```bash
grep -oE '\bD\.[a-zA-Z_]+' templates/<name>.html | sort -u
```

### Never write findings into a template

Put `<p data-narr="layering"></p>` and the generated sentence is filled in at
build time. Slots with nothing to say are removed. Available:
`scale`, `flow`, `layering`, `crossDomain`, `absent`, `skyline`, `cycles`,
`upheld`, `deviations`, `endpoints`, `provenance`, `caveats`.

This exists because the first version had its findings typed into the HTML. The
charts updated for a new project and the paragraphs kept confidently describing
the old one.

## Verifying a lens before you share it

Headless Chromium renders these correctly, canvas included:

```bash
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --virtual-time-budget=9000 --window-size=1600,1050 \
  --screenshot=shot.png "file://$PWD/.metatron/layers.html"
```

The large `--virtual-time-budget` is required: canvas lenses draw on
`requestAnimationFrame`, and a short budget screenshots a blank canvas. Static
checks do not catch mirrored text, washed-out blends, clipped content or tofu
glyphs. Look at it.

## What it can and cannot see

- **Imports are not calls.** The folder and file graphs count imports, type-only
  ones included. Only `endpoints[].flat` follows real `this.x.y()` chains through
  method bodies against constructor injections.
- **DI tokens are invisible.** Anything Nest resolves through a string token
  rather than an imported symbol leaves no edge, so coupling is understated.
- **Structure, not quality.** It can tell you where a transaction script sits and
  what it touches, never whether it is any good.
- **Filenames, not ASTs.** This suits projects whose conventions live in
  filenames. A codebase that carries its architecture in decorators or nothing at
  all needs a different front end.

## Model

`.metatron/model.json`:

`stats` · `coverage` · `tiers` · `flow` · `skipRules` · `nodes` / `edges`
(folder graph) · `fileNodes` / `fileLinks` (file graph, links tagged with the
rule they break) · `modules`, `domainModules`, `platformModules` ·
`allModuleEdges`, `domainEdges` · `cycles` (Tarjan SCCs with sanctioned
carve-outs applied progressively) · `crossDomain` · `ports` · `endpoints` ·
`shape` · `findings`.

## Prior art

Software cities go back to Wettel and Lanza's CodeCity (2007). "Fitness
functions" is from *Building Evolutionary Architectures*. The stacked-plane lens
borrows its geometry from Purdue-model ICS diagrams. What is here is the
coupling: your rules, your code, measured on every run, rendered five ways.

MIT.

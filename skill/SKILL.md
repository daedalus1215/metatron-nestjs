---
name: metatron
description: Build or refresh visual architecture views of a NestJS/TypeScript backend, and check a codebase against its own stated architecture rules. Use when asked to map/visualise/diagram a backend's architecture, to bootstrap architecture views in a project that has none, to refresh them after changes, to add a new visual style, or to find layering violations, cross-context leaks, dead code and naming drift.
---

# metatron

Compiles a NestJS/TypeScript backend into a measured model and renders it through
visual lenses. Repo: `github:daedalus1215/metatron-nestjs`.

## Refreshing an existing setup

If the project already has `arch.config.js`:

```bash
npx metatron                # scan + build every lens
npx metatron scan           # model only
npx metatron views          # re-render from the cached model
npx metatron views layers   # one lens
open .metatron/index.html
```

## Bootstrapping a project that has none

Work in this order. Do not skip step 4 — it is what stops the output being
confidently wrong.

**1. Install.**
```bash
npm i -D github:daedalus1215/metatron-nestjs
```

**2. Read the project's own architecture doc first.** `AGENTS.md`, `CLAUDE.md`,
`README.md`, `docs/`. The config should encode what the project says about
itself: its layer names, its intended call flow, its naming conventions. If the
project states rules, those rules are what to measure against.

**3. Write a minimal config** at the root of the scanned package:
```js
// arch.config.js
module.exports = { extends: 'nestjs', name: '<project>', root: 'src' };
```

**4. Run it and drive coverage up.** The `coverage` line is the signal. Below
90% the tool prints the unmatched filename suffixes — add each to `addPatterns`
with the tier it belongs to, and re-run until coverage settles above ~95%.

```js
addPatterns: [
  { id: 'exception', tier: 'Contract',           test: /\.exception\.ts$/ },
  { id: 'validator', tier: 'Transaction Script', test: /\.validator\.ts$/ },
],
```

Patterns are tested in order and `addPatterns` prepends, so **shape beats
location**: a `*.converter.ts` inside a services folder is a converter. Guard
folder-based overrides against shape-specific names.

**5. Set the flow** if the project's differs from
`['action','service','transaction-script','repository']`. Skip rules are derived
from it — do not hand-list violations.

**6. Set `infraModules` and `crossDomainGateways`** so cross-context checks mean
something: which modules are plumbing, and which patterns a cross-context import
is allowed to land on.

**7. Verify visually before reporting success.** See below.

## Always look at the output

```bash
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --virtual-time-budget=9000 --window-size=1600,1050 \
  --screenshot=/tmp/shot.png "file://$PWD/.metatron/layers.html"
```

Then read the PNG. The large `--virtual-time-budget` is required — canvas lenses
draw on `requestAnimationFrame` and a short budget captures a blank canvas.
Static checks cannot catch mirrored text transforms, washed-out colour blends,
content clipped outside the viewport, or tofu glyphs in the chosen font. All four
have happened.

## Tests

`npm test` runs the fixture suite in `test/`. Add a fixture whenever you fix a
parsing bug — `test/fixtures/indentation/` exists because a route-binding regex
silently bound routes to the wrong method on four-space codebases.

## Adding a lens

`templates/<name>.html` with exactly one `__DATA__` token in a JSON script tag;
it is discovered automatically. Optional `adapters/<name>.js` exporting
`(model) => object` trims the payload.

**Never type a finding into a template.** Use `<p data-narr="layering"></p>` and
the sentence is generated from the model at build time. Slots:
`scale`, `flow`, `layering`, `crossDomain`, `absent`, `skyline`, `cycles`,
`upheld`, `deviations`, `endpoints`, `provenance`, `caveats`. Add new ones in
`src/narrate.js`.

## Reporting findings honestly

- **Check `diagnostics` before trusting endpoint data.** A non-empty list means
  routes were seen but could not be parsed; they are absent from `endpoints`.
  Coverage does not cover this — coverage measures classification only.
- `findings[].tone` is `good` (a rule the code upholds), `warn` (a deviation) or
  `note`. Report the upheld rules too — "zero upward calls across 1,047 imports"
  is a real result, not an absence of news.
- Skip severity: `crit` jumps two or more stations, `warn` jumps one.
- **Say that imports are not calls.** Only `endpoints[].flat` follows real call
  chains. Anything resolved through a DI token string leaves no edge at all, so
  coupling is understated.
- Layout carries no meaning — positions and footprints are chosen so things do
  not overlap. Only heights, tiers, links and colours are data.
- A finding may indict the *document* rather than the code: patterns configured
  but present nowhere usually mean the architecture doc describes a shape that
  was never built.

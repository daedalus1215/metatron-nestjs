---
title: Frontend Scanner — React on the workbench, down to the endpoint
status: implemented
project: metatron-nestjs
location: docs/specs/12-frontend-scanner.md
created: 2026-09-28
tags: [scanner, react, frontend, workbench, full-stack]
implemented: 2026-09-28
---

# Frontend Scanner — React on the workbench, down to the endpoint

## Context

Specs 09–11 made a NestJS backend something you can pick up and turn
over. Every class is a brick, with sockets (what it injects), studs (what
it offers), wires and calls, and a change overlay that says where a PR
meets the existing code. Spec 09 chose that shape so a frontend could take
it too:

> a component is a brick, its props and the hooks and context it consumes
> are its sockets, and what it renders are its connections

The frontends this tool is pointed at are React + TypeScript, built with
Vite, react-router, react-query and axios. They follow a convention as
clear as the backend's:

- pages in `pages/<Page>/`, each with its own `components/` and `hooks/`
- shared `components/` and `hooks/`
- `contexts/`
- request functions in `api/requests/`
- one axios instance, `api`

**Measured on chronus/frontend and omega/frontend (2026-09-28):**

| | chronus | omega |
|---|---|---|
| `.ts`/`.tsx` files | 213 (117 `.tsx`) | 99 |
| components | 123 | 48 |
| … wrapped in `React.memo` / `forwardRef` | 4 | 0 |
| custom hooks | 62 | 34 |
| functions that call the API | 61 | 26 |
| contexts (`createContext`) | 4 | 3 |
| renders of a local component (`<Child`) | 195 | 69 |
| HTTP call sites (`api.get/post/put/patch/delete`) | 68, all with a literal or template URL | — |
| … that match a backend endpoint by verb and path | 67; 68 once an explicit `/api` prefix is stripped | — |
| backend endpoints no frontend call reaches | 3 of 63 | — |

Nothing in either frontend's `node_modules` is installed, so the TypeScript
compiler cannot be borrowed from the project being scanned. The scanner
stays dependency-free, as the backend's is.

The scanner does not read the frontend today at all:

- `walk()` collects only `.ts`, and `resolveSpec` tries only `.ts` and
  `/index.ts`
- `@/` aliases (9 imports in chronus) are unresolved
- the wiring model is Nest's: decorators, constructors and DI

The declaration walker (spec 09) already finds 119 of chronus's 123
components. The 4 it misses are wrapped in `memo`/`forwardRef`. Its string
handling also takes an apostrophe in JSX text (`<p>Don't</p>`) for the
start of a string. That swallows only the rest of the line, but on an
unlucky line it takes a brace with it.

## Goal

1. **Scan a React frontend** into the same wiring model as the backend:
   bricks, sockets, studs, wires, calls and grip, with its own coverage
   line.
2. **Bridge the stack.** Every HTTP call site is matched to the backend
   endpoint it reaches, and says so when it matches none.
3. **One stack on the workbench**: route, page, components, hooks, request
   function, then endpoint, action, service, transaction script,
   repository. Pick up any brick and follow it through the app.

## Design

### A `react` profile

Configured the way the backend is, with a config file beside the `src/`:

```js
// frontend/arch.config.js
module.exports = {
  extends: 'react',
  root: 'src',
  aliases: { '@': 'src' },        // import prefixes, as in vite/tsconfig
  backend: '../backend',          // optional: the linked backend's config dir
  apiPrefix: '/api',              // what the HTTP client prepends
};
```

The profile's **tiers** are ordered the way a user's action travels,
matching the backend's "the way a request travels":

| tier | patterns |
|---|---|
| Route | `router`, `app` (the file that declares `<Route>`s) |
| Page | `page` (`pages/<Page>/<Page>.tsx`) |
| Component | `component` (any other `.tsx` exporting a component) |
| Hook | `hook` (`use*.ts(x)`, `hooks/`) |
| State | `context`, `store` |
| Request | `request` (`api/`, `*.requests.ts`), `adapter` |
| Contract | `dto`, `types` |
| Support | `util`, `lib`, `constants`, `theme`, `style` |
| Platform | `bootstrap` (`main.tsx`), `config` |
| Test | `spec` / `test` |

`patterns`, `tiers` and `aliases` are data, as in the `nestjs` profile. A
project with a different layout overrides them, and the coverage line says
when it should.

### Scanning `.tsx`

- `walk()` takes `.tsx` as well as `.ts`.
- `resolveSpec` tries `.ts`, `.tsx`, `/index.ts` and `/index.tsx`, and maps
  `aliases` prefixes before resolving.
- **The walker gets a JSX mode, for `.tsx` only.** When `<` opens an element
  in expression position, it reads the element instead of treating it as
  code:
  - "Expression position" means after `(`, `=`, `return`, `?`, `:`, `,`,
    `&&`, `||`, `=>`, `{` or `[`. A `<` after an identifier (`useState<T>(`)
    stays a type argument, and so does `<T,>`.
  - Tags and attributes are read as tags and attributes.
  - Children are text, except `{…}` expressions, which recurse as code.
  - An apostrophe or `//` in JSX text is text.
- **`memo` and `forwardRef`.** `const X = memo(…)` and
  `const X = React.forwardRef<…>(…)` are read as the component their
  argument is. The brick carries `wrapped: 'memo' | 'forwardRef'`.

The walker's health is checked the way coverage is. A file whose top level
ends with an unbalanced bracket gets a `parse-unbalanced` diagnostic, not a
silent miss.

### Bricks

| brick | what | id |
|---|---|---|
| **component** | a capitalised function or `const` arrow in a `.tsx` that returns JSX, or a wrapped one | `file#Name` |
| **hook** | an exported `use*` function | `file#useName` |
| **context** | a `createContext(…)`, with its Provider | `file#NameContext` |
| **functions** | a file of exported non-component, non-hook functions (request modules, utils). As on the backend: the file is the brick, its functions are studs | `file` |
| **class** | a class (rare: 4 in chronus), read as on the backend | `file#Class` |
| **script** | `main.tsx` | `file` |

Every component and hook is its own brick, even when a file holds several.
That is the backend's one-brick-per-class rule, applied to the frontend's
unit.

### Sockets: what a brick uses

For a component or a hook, the sockets are **the hooks it calls and the
contexts it reads**, in order of first use:

| status | meaning |
|---|---|
| `resolved` | a custom hook, or a context, in the tree |
| `framework` | a hook from a package: React (`useState`, `useEffect`, …), react-router, react-query, MUI, … with `from` naming the package |
| `unresolved` | a `use*` call metatron cannot place, with a diagnostic |

A socket's `to` is the hook's or context's brick. `useContext(NotesContext)`
and a custom hook wrapping it both resolve to the context brick; the second
also resolves to the hook.

**Props are not sockets.** They are what a parent supplies when it renders
the component, and they are recorded on the render stud (below). Treating
them as sockets would draw every parent-child render twice.

### Studs: what a brick offers

| brick | studs |
|---|---|
| component | one stud, `render`, whose `sig` is its props type (`NoteRowProps`, or the inline `{ … }`) and whose `props` lists the prop names |
| hook | one stud, the hook, with its signature |
| context | `Provider`, and `value` (its type) |
| functions | its exported functions. A request function's stud also carries `http: [{ verb, path, line }]` for each call it makes through the client |

Grip is read as on the backend:

| grip | meaning |
|---|---|
| `brick` | something uses it |
| `route` | it is mounted by a `<Route>` |
| `unseen` | nothing metatron can see renders, calls or mounts it |

### Connections

`wires` are the resolved sockets, as on the backend.

`calls` gain a `kind`. A backend call is `call`, so existing calls read the
same:

| kind | from → to | example |
|---|---|---|
| `render` | component → component | `<NoteRow …/>` in `NoteList` |
| `hook` | component or hook → hook | `useNotes()` in `NotePage` |
| `context` | component or hook → context | `useContext(SidebarContext)` |
| `call` | anything → a function brick's stud | `getNoteAudios(id)` in `useNoteAudios` |
| `http` | request function → a backend endpoint (spec: *The bridge*) | `api.get(`/audio/note/${noteId}`)` |

A render is recorded where the JSX tag names a component imported from the
tree, or declared in the same file. `<Box>` and `<Route>` are package
components: they are counted on the brick (`framework renders: 41`) but are
not edges.

### Routes

The file that renders `<Routes>` is read for its `<Route>` tree:

- `path` is a string literal, or a member of a constant object in the tree
  (`ROUTES.HOME`, resolved through its `as const` object).
- `element` is `<Page/>`.
- Nested routes join their paths.

The result is a `routes` table (`{ path, component, parent, line }`), which
the page components' `route` grip reads. A path that is a function
(`ROUTES.NOTE(id)`) or computed is kept, with `path: null` and a
diagnostic.

### The bridge

When `backend` is set, the backend's config is loaded and scanned (or read
from its cached `model.json`, when that is newer than every file under its
root).

Each HTTP call site is matched to an endpoint:

1. The URL is taken as the call's first argument: a string literal, or a
   template with `${…}` holes.
2. `apiPrefix` is stripped if the URL starts with it.
3. The URL is matched against each endpoint's route by verb, with the route's
   `:params` and the template's `${…}` holes each matching one segment.
   The query string is ignored.

| result | meaning |
|---|---|
| **matched** | exactly one endpoint. The call gets `endpoint: <endpoint id>`, and the stud's `http` entry names it |
| **ambiguous** | more than one endpoint matches. Listed, not picked |
| **unmatched** | none matches. A diagnostic, `http-unmatched`, names the call. On a live codebase this is a call to an endpoint that does not exist, or a URL built in a way metatron does not read |
| **unread** | the URL is not a literal or a template (a variable, a built string). A diagnostic, `http-unread` |

The coverage line:

```
http   68/68 calls matched a backend endpoint · 0 unmatched · 0 unread
       3 of 63 endpoints are reached by no frontend call
```

The unreached endpoints are listed. They are the same kind of lead as an
`unseen` stud: dead API surface, or callers outside this frontend (a
mobile app, a script, another service).

### One stack on the workbench

`metatron-nest serve` in a frontend with `backend` set serves **both** models
as one payload:

- **Ids are namespaced** `fe:` and `be:`, since both trees have a
  `main.ts(x)`.
- **Tiers stack:** the frontend's tiers above the backend's, so a stack
  reads from the route down to the repository.
- **Each `http` call is an edge** from the request function's brick to the
  backend action that owns the endpoint (its handler stud gripped by
  `http`), drawn like a call.
- **The brick list groups by side, then module.**
- **Source is served for both trees.**

Serving the backend alone, or a frontend with no `backend`, works as it
does today.

`serve` watches both roots when it holds both models.

### What the page refuses

- **No invented edges.** A render is an imported component's tag, a hook
  call is `use*(`, an HTTP edge is a matched URL.
- **Package components and hooks are not bricks.** MUI, react-router and
  react-query are the framework, like `Repository<T>` on the backend.

## Increments

1. Walker: the JSX mode, and `memo`/`forwardRef`.
2. `.tsx` and aliases in the scan, and the `react` profile, with coverage on
   both frontends.
3. React wiring: bricks, sockets, studs, calls, grip, routes, and the CLI
   line.
4. The bridge: the backend link, matching, the `http` line, diagnostics.
5. The workbench: a frontend on its own, then the joined stack.
6. Docs: README, skill, results.

## Acceptance

1. **Walker.** Fixture strings: JSX text with apostrophes, `//` and braces;
   generic arrows (`<T,>`); `useState<T>()`; nested elements with `{expr}`
   children and attribute expressions; `memo`/`forwardRef` components. On
   chronus's 117 `.tsx` files: 0 `parse-unbalanced`, and all 123
   components found.
2. **Profile.** Coverage of at least 95% on both frontends with the default
   `react` profile, or the gap is named.
3. **Wiring,** on a fixture frontend: a page mounted by a route; a component
   rendering a child with props; a custom hook wrapping `useContext`; a
   request function called by a hook; a framework hook; a component nothing
   renders (`unseen`).
4. **Bridge.** On chronus, 68/68 HTTP calls are matched, and the 3
   unreached endpoints are named. On a fixture: a template URL, an explicit
   prefix, an ambiguous match, an unmatched URL and an unread URL.
5. **Workbench.** Serving chronus/frontend with its backend draws the
   `NotePage` stack from its route down to a repository, with no console
   errors.
6. **Backend unchanged.** The chronus and omega backend models are identical
   before and after, on every key.

## Results (2026-09-28)

| | chronus/frontend | omega/frontend |
|---|---|---|
| coverage with the default `react` profile | 211/212 (99.5%) | 98/98 |
| components found (capitalised declarations) | 127/127, the 4 wrapped included | 48/48 |
| `.tsx` files unbalanced / boundaries changed by JSX mode | 0 / 0 | 0 / 0 |
| bricks | 127 components, 62 hooks, 4 contexts, 18 function files, 4 classes | 48 components, 34 hooks, 3 contexts |
| hooks & contexts used (unresolved) | 440 (0) | 193 (0) |
| renders in the tree / of package components | 177 / 1259 | 62 / — |
| routes, to a brick | 25, 21 (4 are `<Navigate>`) | 11, 7 |
| HTTP calls matched | **68/68**, 0 ambiguous | 27 (no backend linked) |
| endpoints no frontend call reaches | 2 of 63: `GET /healthz`, `GET /check-items/items/:id` | — |
| scan time | 0.6 s cold, 0.27 s with the backend cached | 0.08 s |

The spec's hand measurement said 3 unreached. The bridge's scoring matched
one that a first-match regex had missed.

**Findings the scan turned up in chronus:**

- **18 components call the request layer directly**, not through a hook,
  against the frontend's own convention. For example, `FolderTree` imports
  `createFolder` and `deleteFolder`.
- **3 import paths name no file.** `ExplorerTree/utils.ts` reaches five
  levels up, out of `src/`. `CheckItemFilterBar` imports
  `../hooks/useCheckItemFilters`, which is one level too shallow. And
  `timeTrackDB.ts` imports a `types/` path that does not exist.
- **Unseen components**, reached by nothing in the tree: `DesktopLayout`,
  `Layout`, `SidebarToggleIconInverted`, `Error`, `FolderTree`,
  `NotesBrowser`, `DesktopTagListView`, `ProtectedRoute`, and a second
  `NoteActionsGrid`.

**The workbench.** Serving chronus/frontend joins 249 frontend and 271
backend bricks, with 68 HTTP edges. `NotePage` at depth 5 hits the node cap
inside the frontend, because its UI fan-out is wide. The **data path**
switch keeps only the bricks that lead to the backend. With it, depth 6
draws 176 bricks from `AppRoutes` through 36 frontend bricks and 55 HTTP
edges down to repositories and hydrators, and nothing is cut. There are no
console errors, and clicking through from a request function to its action
works.

**What the real code taught the design:**

- **Mounts are not renders.** `<Route element={<Page/>}>` is a mount, so a
  page's grip reads `route`.
- **Components are also passed as values** (`slots={{ item: … }}`). Those
  count as uses.
- **A name in a comment, a string, JSX text or an import is not a use.** The
  walker now reports those ranges.
- **Helpers beside a hook get a brick.** One of the 68 HTTP calls lived in a
  non-exported helper, and was missed until they did.
- **A Vite `package.json` is `"type": "module"`,** so a CommonJS
  `arch.config.js` fails there. `.cjs` and `.mjs` configs are found, and an
  ES module config's default export is read.
- **Two more places assumed `.ts`:** the watcher, and change mode's
  `baseFileMap`. On a frontend the first missed `.tsx` saves, and the second
  dropped every component from a commit.
- **The `layers` view hard-coded the nestjs profile's 11 tiers.** Its planes
  now come from the model.

The backend models of chronus and omega are identical before and after, on
every key, checked against a worktree of the spec commit after each step.

## Out of scope

- **The change overlay across both sides.** A PR touching the frontend and
  the backend is a follow-up. The overlay's `compare()` is side-agnostic,
  so it is mostly a matter of serving both.
- **Frameworks other than React**, and state libraries beyond context
  (Redux, Zustand). The brick shape fits them; nothing here reads them.
- **The static lenses** (city, atlas, layers) for a frontend. They are
  built on the file graph and patterns, so they should render with the
  `react` profile, but nothing here tunes them.
- **Props flowing through renders** (which parent passes what). The render
  edge records that a parent renders a child, not the values passed.

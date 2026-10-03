# Checklist

What's next for metatron. Tick an item when it lands on `main`. An item that
grows past a few commits becomes a spec in [`docs/specs/`](docs/specs/README.md),
and this list links to it.

## Next

- [ ] **Nested shapes in contracts.** Compare one level into a field such as
  `checkItems: CheckItem[]`, so a field renamed inside a nested object is
  caught. Spec 15 stops at the top level.

## Open

**Contracts** (spec 15, out of scope there)

- [ ] **Field types.** `string` against `number`, with a rule for indexed
  types like `Note['id']`, which should not be reported against `number`.
- [ ] **Query and path parameters.** A `@Query()` DTO against the URL's query
  string, and `@Param()` names against the template's holes.
- [ ] **Shapes inferred from code.** An untyped handler's return, or an
  untyped `res.data`. Today both are unread.

**Frontend**

- [ ] **Other HTTP clients:** ky, ofetch. Axios and `fetch` are read.
- [ ] **Props through renders:** which parent passes what to a child. A render
  edge records only that the parent renders it.

**Backend**

- [ ] **A module nobody imports.** `controller-unregistered` checks that a
  module lists the controller, not that the app imports that module. A
  controller in an orphaned module is still not served.

**Across repositories**

- [ ] **`diff` and `check` from the backend directory.** The backend config
  does not know its frontend, so both run from the frontend today.
- [ ] **A backend in another repository during PR mode.** It needs a way to
  pair commits across two repositories.

## Parked

There is nothing in chronus or omega to test these against yet.

- [ ] **Backend call shapes:** a destructured dependency
  (`const { repo } = this`), a call through a local alias
  (`const r = this.repo`), and a subclass using its parent's injections.
- [ ] **Ports:** module scoping (`imports` / `exports`) and dynamic modules
  (`forRootAsync()`).
- [ ] **Redux, Zustand, and frameworks other than React.**

## Watching

- [ ] **`test/coupling.test.js` failed once** during a full run, while the
  machine was busy. It has not failed in 20 runs since, 12 of them with four
  suites in parallel. If it fails again, the test now prints the reason the
  scan could not read the history, which should say whether git failed.

## Done

- [x] Contracts follow a renamed import (`import { Foo as Bar }`).
- [x] Contracts read a type imported from a package as unread, not as a
  same-named type in the tree.
- [x] A type's own references are looked up from the file that declares it.
- [x] Two HTTP calls on one line keep their own endpoint and contract, on the
  stud and in the inspector.
- [x] `diff --staged` reports the contract drift of what is staged (tested).
- [x] A controller no module lists is `controller-unregistered`, and a call
  that reaches only its routes is `unserved` and broken. Caught chronus's
  `DELETE /notes/:id`, dropped from the notes module by `dae3a70`.
- [x] A stack change lists the calls it fixed.
- [x] A frontend's `orphans` are walked from `main.tsx`, following lazy
  imports, not from backend roots it does not have.
- [x] A file's loose functions beside a same-named component are named for
  the file (`TagActionPanel.tsx`), so a list never shows two of one name.
- [x] Hovering a line or a legend item on the workbench explains it.

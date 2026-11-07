---
title: Create a brick — from the workbench, through a model, checked by the scan
status: draft
project: metatron-nestjs
location: docs/specs/17-create-a-brick.md
created: 2026-11-07
tags: [workbench, intent, agent, placement, editing]
---

# Create a brick — from the workbench, through a model, checked by the scan

## Context

The workbench (spec 10) reads code, and nothing on it changes the code.
This spec adds the first edit: **create a new brick** where it belongs.
Creating comes before connecting existing bricks (spec 18) for three
reasons:

- It mostly adds files, and touches little that exists: the brick it
  attaches to, and the module that registers it.
- What may be created where is already in the config. The flow,
  `forbidden`, `noSameLevel` and spec 16's placement kinds say which patterns
  a station may depend on, and where each one's file goes.
- The result is easy to check. Either the scan finds the new brick, with the
  right pattern, in the right place and wired as asked, or it does not.

**Metatron does not write the code. A model does.** Metatron turns a gesture
into an **intent**: a record of what to create, and a prompt built from the
model's facts. A runner hands the prompt to a coding agent, and which agent
is a config line: omp with a local model, Claude Code, or none, in which case
you copy the prompt yourself. When the agent is done, metatron re-scans and
checks the intent's end state. **The verdict comes from the scan, never from
the agent's account of what it did.** That matters more with a small local
model, which drifts more often.

## Goal

On the workbench:

1. Pick a brick. **Add below** opens a palette of the patterns it may
   depend on.
2. Choose a pattern and type a name. A **ghost brick** appears where the new
   file will go, with its path, its class name, and a dashed wire to the
   brick it attaches to.
3. **Make it** writes the intent, then runs the agent or shows the prompt to
   copy.
4. The bench redraws as files change. When the agent finishes, the verdict
   either snaps the ghost solid or marks it red with a checklist of what
   missed.

Same module only. Backend only.

## Design

### The palette: what may be created below a station

A new brick N below a station S means S will depend on N. A pattern is
offered when all of these hold:

- **It is downstream.** N's tier is later than S's in `tiers`, or N is
  owned by S's kind (spec 16: an action's DTO, a transaction script's
  command or projection). The flow runs downward. A dependency that points
  upward is never offered, even where no rule forbids it yet.
- **No `forbidden` rule** names S's pattern to N's.
- **It is not same-level:** N's pattern is not S's when S's pattern is in
  `noSameLevel`.
- **It skips no station:** S and N are not both in the flow with a station
  between them.
- **It has somewhere to go:** an anchored pattern needs a layout (spec 16),
  and an owned or cohesive one goes in S's own folder, or beside S.

Every pattern that is not offered is listed greyed, with the config's own
reason: the `why` of the `forbidden` rule, or of the derived skip rule.

| below | offered (abridged) | not offered, and why |
|---|---|---|
| a service | transaction script, aggregator; converter, mapper, assembler; cache; entity, port; util | repository, remote caller: *Service reaches Repository directly, skipping Transaction Script*. Service: same level (`noSameLevel`). Action, guard: upstream |
| a transaction script | repository, remote caller, cache; converter, mapper, assembler; command, projection (owned); entity, port; util | service: *Transaction Script calls upward into a Service*. Transaction script: same level. Aggregator, action: upstream |
| an action | service; DTO, responder, swagger (owned); converter, mapper | transaction script: *Action reaches Transaction Script directly, skipping Service*. Repository: the same, skipping two |

Modules, configs and strategies are never offered: they wire bricks
together, and nothing depends on them.

**The palette is exactly as strict as the config.** The nestjs profile lets
a service depend on a cache, because nothing forbids it. If you do not want
that, the fix is a `forbidden` rule, which `check` will then also enforce. The palette never
holds a rule of its own that `check` does not.

### Naming and placing

You type a name in kebab case: `archive-tag`. The rest is learned from the
tree:

- **Path:** an anchored pattern uses its layout, so
  `{module}/domain/transaction-scripts/{name}-TS/{name}.transaction.script.ts`
  becomes `tags/domain/transaction-scripts/archive-tag-TS/archive-tag.transaction.script.ts`.
  An owned or cohesive one goes in S's own folder, named after it:
  `archive-tag-TS/archive-tag.command.ts`.
- **Class name:** PascalCase name plus the suffix the pattern's classes
  share: `ArchiveTagTransactionScript`. The suffix is learned the same way a
  layout is, by majority with a share.
- **Injected or imported:** learned per pattern. A pattern is injected when
  most of its classes are some socket's target, and then the intent also
  asks for it to be registered in its module's `providers`. Otherwise it is
  imported.
- **An example to imitate:** the nearest existing file of the same pattern,
  first in the same module, so the agent copies the house style rather than
  inventing one. For `archive-tag`, that is `delete-tag.transaction.script.ts`.

**A pattern with no layout is not guessed at.** Chronus's services have
none (6/10, spec 16), so creating one asks you to choose among the layouts
the tree uses, each shown with its count.

### The intent

Saved as `.metatron/intents/<id>.json`, with the rendered prompt beside it
as `<id>.md`:

```json
{
  "id": "20261107-01-archive-tag",
  "kind": "create",
  "pattern": "transaction-script",
  "name": "archive-tag",
  "class": "ArchiveTagTransactionScript",
  "path": "tags/domain/transaction-scripts/archive-tag-TS/archive-tag.transaction.script.ts",
  "attach": { "to": "tags/domain/services/tag.service.ts#TagService", "as": "socket" },
  "register": "tags/tags.module.ts",
  "example": "tags/domain/transaction-scripts/delete-tag-TS/delete-tag.transaction.script.ts",
  "base": { "head": "<commit>", "dirty": [] },
  "expect": ["brick", "pattern", "wire", "registered", "placement", "no-new-violations", "files"]
}
```

The prompt says, in plain sentences:

- what to create, its path and class name, and the example to follow
- which brick injects it, through which constructor, and which module
  registers it
- the rule it sits under: `action → service → transaction-script →
  repository`
- to leave the method bodies as the example's shape with a `TODO` where
  logic belongs, since the gesture says where the brick goes, not what it
  does
- to change no file other than the ones listed, and not to commit
- **Done when**, the same checks the verdict runs, written out

The intent is the unit of work, whichever agent runs it. A prompt that keeps
failing on a local model is fixed in the template, once, for every agent.

### The runner: any agent, by config

```js
// arch.config.js
agent: {
  run: ['omp', '-p', '--model', '<local-model>', '--cwd', '{root}', '@{promptFile}'],
  // run: ['claude', '-p', '{prompt}'],
  verify: ['npx', 'tsc', '--noEmit'],   // optional, run after the agent
},
```

- `{prompt}` is the prompt's text, `{promptFile}` its path, and `{root}` the
  repository root. The run happens in `{root}`.
- **With no `agent`, the bench shows the prompt with a copy button** and
  waits. The watcher already re-scans on save, so the verdict runs when the
  expected file appears, or when you press **Check**.
- The agent's output streams into a panel on the bench over the event stream
  the workbench already has. **Stop** kills the process.
- `verify` is optional. Its exit code and last lines are part of the
  verdict.

Metatron never commits. The changes stay in the working tree. Undoing is
`git checkout` on the changed files, plus deleting the new ones, and the
verdict lists both.

**Before a run, the files the intent will touch must be clean.** If
`tag.service.ts` has unsaved edits, the run is refused and the file named.
Otherwise the verdict could not tell the agent's edits from yours, and undo
would throw yours away.

### The verdict

After the agent exits, or when the expected file appears in copy mode, the
tree is re-scanned and each expectation is checked:

| check | passes when |
|---|---|
| `brick` | a brick exists at `path` with the class name |
| `pattern` | the scan classifies it as the pattern asked for, in its tier. A file named so that it matches nothing fails here, not later |
| `wire` | the brick it attaches to has a socket, or an import, resolving to it |
| `registered` | (injected patterns) the module lists it, and the socket's status is resolved |
| `placement` | spec 16's verdict for the new file is fits |
| `no-new-violations` | the violations' fingerprints, before against after, gained none (spec 02's comparison) |
| `files` | the changed files are the ones the intent listed. Others are listed as **also changed**: a note, not a failure |
| `verify` | (if set) the command exits 0 |

The verdict is **landed**, **landed with notes** (only `files` or a
non-gating note), or **missed**, with each check shown. It is saved with
the intent, so `.metatron/intents/` is a log of what was asked and what
happened.

### On the bench

- **Planned:** a ghost brick, dashed, in its tier row, with a dashed wire to
  the brick it attaches to. It is the opposite of the removed-brick ghost
  from spec 11, which is struck through.
- **Running:** the output panel streams. Each brick whose file changes
  pulses as the watcher re-scans.
- **Landed:** the ghost fills in and the wire turns solid.
- **Missed:** the ghost turns red, and the checklist opens. Whatever the
  agent did change is one click away as a change map of the working tree
  (spec 11).
- With `prefers-reduced-motion`, the states change without animating.

### Safety

The workbench is read-only today: it refuses anything but `GET`. Creating
needs a write endpoint, and an endpoint that starts an agent is worth more
to an attacker than one that writes a file. Any web page the browser visits
can send a request to `127.0.0.1`. So:

- Editing is off unless the server starts with **`serve --edit`**.
- Each request must carry a token, generated per server start and written
  into the page it serves.
- The `Host` and `Origin` headers must name the server's own address.
  Anything else is refused, which also stops DNS rebinding.
- The agent runs only on an explicit **Make it**, once per intent.

## Increments

1. The palette, as a pure function of the config and the model, with its
   reasons. Fixture tests for each row of the table above.
2. Naming and placing: path, class suffix, injected or imported, the example
   to follow.
3. The intent record, and the prompt template.
4. The verdict, run against a hand-made change in a fixture tree: one that
   lands, and one of each kind of miss.
5. `serve --edit`, the token and the header checks.
6. On the bench: the palette, the ghost, copy mode.
7. The runner: the command template, streaming, stop, `verify`.
8. The animation.
9. README and skill.

## Acceptance

- Below chronus's `TagService`, the palette offers a transaction script and
  does not offer a repository, quoting the skip rule's reason.
- `archive-tag` is placed at
  `tags/domain/transaction-scripts/archive-tag-TS/archive-tag.transaction.script.ts`
  as `ArchiveTagTransactionScript`, to be registered in `tags/tags.module.ts`,
  following `delete-tag.transaction.script.ts`.
- In a fixture, an agent's result that names the file
  `archive-tag.script.ts` misses on `pattern`. One that puts it in the
  service's folder misses on `placement`. One that forgets the module misses
  on `registered`.
- The same intent runs under omp and under Claude Code with only the
  `agent.run` line changed.
- Without `--edit`, every write endpoint answers 405. With it, a request with
  no token, or a foreign `Origin`, is refused.

## Open questions

1. **Add above** (a new caller of an existing brick, such as a new action
   over a service) is the same palette, read the other way. Is it needed in
   this spec, or is **add below** enough to start?
2. **A vertical slice in one gesture**: action, then service method, then
   transaction script, command and projection. That is several intents in
   order. Is it a later spec, or the first thing worth having?

## Out of scope

- **Connecting, detaching and rewiring existing bricks:** spec 18.
- **Creating across modules.** It needs Nest module scope (`imports` and
  `exports`), which metatron does not model. It is on the checklist's Parked
  list.
- **The frontend.** The same machinery fits components and hooks, once
  spec 16 has rules for where they live.
- **Writing logic.** The intent places and wires a brick. Its methods are the
  example's shape with a `TODO`, for you or the agent to fill in.

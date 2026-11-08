'use strict';
/**
 * Placement (spec 16), first part: each file's kind, users and owner, and
 * each station's own folder. Fixture-free: in-memory backends.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const react = require('../src/defaults/react');
const { placementOf } = require('../src/placement');

const ACTION = 'notes/apps/actions/create-note-action';
const TS = 'notes/domain/transaction-scripts/create-note-TS';
const TREE = {
  'notes/notes.module.ts': `import { CreateNoteAction } from './apps/actions/create-note-action/create-note.action';
import { NoteService } from './domain/services/note.service';
import { CreateNoteTransactionScript } from './domain/transaction-scripts/create-note-TS/create-note.transaction.script';
export class NotesModule {}
`,
  [`${ACTION}/create-note.dto.ts`]: 'export class CreateNoteDto { name!: string; }\n',
  [`${ACTION}/create-note.action.ts`]: `import { CreateNoteDto } from './create-note.dto';
import { NoteService } from '../../../domain/services/note.service';
export class CreateNoteAction { constructor(private readonly notes: NoteService) {} apply(dto: CreateNoteDto) { return dto; } }
`,
  'notes/domain/services/note.service.ts': `import { CreateNoteTransactionScript } from '../transaction-scripts/create-note-TS/create-note.transaction.script';
import type { CreateNoteCommand } from '../transaction-scripts/create-note-TS/create-note.command';
export class NoteService { constructor(private readonly create: CreateNoteTransactionScript) {} }
`,
  'notes/domain/services/folder.service.ts': 'export class FolderService {}\n',
  [`${TS}/create-note.command.ts`]: 'export type CreateNoteCommand = { name: string };\n',
  [`${TS}/create-note-to-entity.converter.ts`]: `import { CreateNoteCommand } from './create-note.command';
export class CreateNoteToEntityConverter { apply(c: CreateNoteCommand) { return c; } }
`,
  [`${TS}/create-note.transaction.script.ts`]: `import { CreateNoteCommand } from './create-note.command';
import { CreateNoteToEntityConverter } from './create-note-to-entity.converter';
import { NoteRepository } from '../../../infra/repositories/note.repository';
export class CreateNoteTransactionScript { constructor(private readonly repo: NoteRepository) {} apply(c: CreateNoteCommand) { return c; } }
`,
  [`${TS}/__specs__/create-note.transaction.script.spec.ts`]: `import { CreateNoteTransactionScript } from '../create-note.transaction.script';
import { CreateNoteToEntityConverter } from '../create-note-to-entity.converter';
`,
  'notes/infra/repositories/note.repository.ts': 'export class NoteRepository {}\n',
  'shared-kernel/domain/cross-domain-commands/notes/get-note-details.command.ts': 'export class GetNoteDetailsCommand {}\n',
};
const cfgOf = (profile) => Object.assign({}, profile, { name: 'be', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react-backend') });
const run = (files) => scan(cfgOf(nestjs), { files });

// A file's placement, with indices turned back into paths.
const at = (m, f) => {
  const i = m.fileNodes.findIndex((n) => n.f === f);
  assert.ok(i >= 0, `no file ${f}`);
  const e = m.placement[i];
  if (!e) return e;
  const out = { kind: e.kind, users: e.users.map((u) => m.fileNodes[u].f) };
  if ('owner' in e) out.owner = m.fileNodes[e.owner].f;
  return out;
};
const patternOf = (m, f) => m.fileNodes.find((n) => n.f === f).p;

test('each file is anchored, owned or cohesive, and modules and tests are not placed', () => {
  const m = run(TREE);
  assert.strictEqual(m.placement.length, m.fileNodes.length);
  assert.strictEqual(at(m, `${ACTION}/create-note.action.ts`).kind, 'anchored');
  assert.strictEqual(at(m, `${ACTION}/create-note.dto.ts`).kind, 'owned');
  assert.strictEqual(at(m, `${TS}/create-note.command.ts`).kind, 'owned');
  assert.strictEqual(at(m, `${TS}/create-note-to-entity.converter.ts`).kind, 'cohesive');
  assert.strictEqual(at(m, 'notes/notes.module.ts'), null);
  assert.strictEqual(at(m, `${TS}/__specs__/create-note.transaction.script.spec.ts`), null);
  assert.deepStrictEqual(m.placementMeta.kinds, { anchored: 6, owned: 2, cohesive: 1 });
});

test('a cross-domain command is its own pattern, and anchored like a port', () => {
  const m = run(TREE);
  const f = 'shared-kernel/domain/cross-domain-commands/notes/get-note-details.command.ts';
  assert.strictEqual(patternOf(m, f), 'cross-domain-command');
  assert.strictEqual(at(m, f).kind, 'anchored');
  assert.strictEqual(patternOf(m, `${TS}/create-note.command.ts`), 'command');
});

test('users are the importing files, type-only imports included, modules and tests left out', () => {
  const m = run(TREE);
  assert.deepStrictEqual(at(m, `${TS}/create-note.transaction.script.ts`).users, ['notes/domain/services/note.service.ts']);
  assert.deepStrictEqual(at(m, `${TS}/create-note.command.ts`).users.sort(), [
    'notes/domain/services/note.service.ts',
    `${TS}/create-note-to-entity.converter.ts`,
    `${TS}/create-note.transaction.script.ts`,
  ]);
  assert.deepStrictEqual(at(m, `${TS}/create-note-to-entity.converter.ts`).users, [`${TS}/create-note.transaction.script.ts`]);
});

test("a station's own folder is named after it and holds it alone; what lives inside is owned by it", () => {
  const m = run(TREE);
  const own = Object.fromEntries(Object.entries(m.placementMeta.ownFolders).map(([d, i]) => [d, m.fileNodes[i].f]));
  assert.deepStrictEqual(own, {
    [ACTION]: `${ACTION}/create-note.action.ts`,
    [TS]: `${TS}/create-note.transaction.script.ts`,
  });
  assert.strictEqual(at(m, `${ACTION}/create-note.dto.ts`).owner, `${ACTION}/create-note.action.ts`);
  assert.strictEqual(at(m, `${TS}/create-note-to-entity.converter.ts`).owner, `${TS}/create-note.transaction.script.ts`);
  assert.ok(!('owner' in at(m, `${TS}/create-note.transaction.script.ts`)), 'its own folder does not own the station');
  assert.ok(!('owner' in at(m, 'notes/infra/repositories/note.repository.ts')));
});

test("a folder holding two stations is nobody's, and a module's root folder is never a station's", () => {
  const m = run({
    'tags/domain/transaction-scripts/tag-TS/tag.transaction.script.ts': 'export class TagTransactionScript {}\n',
    'tags/domain/transaction-scripts/tag-TS/tag-two.transaction.script.ts': 'export class TagTwoTransactionScript {}\n',
    'tags/domain/transaction-scripts/tag-TS/tag.converter.ts': 'export class TagConverter {}\n',
    'tags/tags.service.ts': 'export class TagsService {}\n',
    'tags/tag.util.ts': 'export const x = 1;\n',
  });
  assert.deepStrictEqual(m.placementMeta.ownFolders, {});
  assert.ok(!('owner' in at(m, 'tags/domain/transaction-scripts/tag-TS/tag.converter.ts')));
  assert.ok(!('owner' in at(m, 'tags/tag.util.ts')));
});

test("a station inside another station's own folder is owned by it", () => {
  const m = run({
    'notes/apps/actions/save-action/save.action.ts': 'export class SaveAction {}\n',
    'notes/apps/actions/save-action/inner/save.repository.ts': 'export class SaveRepository {}\n',
  });
  assert.strictEqual(at(m, 'notes/apps/actions/save-action/inner/save.repository.ts').owner, 'notes/apps/actions/save-action/save.action.ts');
});

test('a frontend profile declares no placement, so the model has none', () => {
  const m = scan(cfgOf(react), { files: { 'components/Button.tsx': 'export const Button = () => null;\n' } });
  assert.ok(!('placement' in m));
  assert.ok(!('placementMeta' in m));
});

test('pure: one more link is one more user, so spec 18 can ask "what if"', () => {
  const m = run(TREE);
  const i = (f) => m.fileNodes.findIndex((n) => n.f === f);
  const conv = i(`${TS}/create-note-to-entity.converter.ts`);
  const repo = i('notes/infra/repositories/note.repository.ts');
  const before = placementOf(nestjs.placement, m.fileNodes, m.fileLinks);
  const after = placementOf(nestjs.placement, m.fileNodes, m.fileLinks.concat([[repo, conv]]));
  assert.deepStrictEqual(before.placement[conv].users, m.placement[conv].users);
  assert.deepStrictEqual(after.placement[conv].users, [...m.placement[conv].users, repo].sort((a, b) => a - b));
});

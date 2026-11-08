'use strict';
/**
 * `forbidden` rules: a direction imports must never take. A rule's `from`
 * and `to` are each a pattern or a list of them. Fixture-free: in-memory
 * backends.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const TS = 'notes/domain/transaction-scripts/update-note-TS';
const TREE = {
  'notes/apps/actions/update-note-action/update-note.dto.ts': 'export class UpdateNoteDto { name?: string; }\n',
  'notes/apps/actions/update-note-action/update-note.action.ts': `import { UpdateNoteDto } from './update-note.dto';
export class UpdateNoteAction { apply(dto: UpdateNoteDto) { return dto; } }
`,
  [`${TS}/update-note.command.ts`]: 'export type UpdateNoteCommand = { name?: string };\n',
  [`${TS}/update-note.transaction.script.ts`]: `import { UpdateNoteDto } from '../../../apps/actions/update-note-action/update-note.dto';
export class UpdateNoteTransactionScript { apply(dto: UpdateNoteDto) { return dto; } }
`,
  'notes/domain/services/note.service.ts': `import { UpdateNoteDto } from '../../apps/actions/update-note-action/update-note.dto';
import { UpdateNoteCommand } from '../transaction-scripts/update-note-TS/update-note.command';
export class NoteService { update(dto: UpdateNoteDto): UpdateNoteCommand { return dto; } }
`,
};
const DTO = 'notes/apps/actions/update-note-action/update-note.dto.ts';
const cfgWith = (forbidden) => Object.assign({}, nestjs, {
  name: 'be', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react-backend'), forbidden,
});
const upward = (m) => m.findings.find((f) => f.id === 'no-upward');

test('a rule with lists forbids every pair of its patterns, and a string rule still works', () => {
  const m = scan(cfgWith([
    { from: ['service', 'transaction-script'], to: ['dto'], why: 'The domain takes a DTO' },
    { from: 'service', to: 'command', why: 'A service builds a command' },
  ]), { files: TREE });
  assert.deepStrictEqual(upward(m).instances.map((i) => [i.from, i.to]).sort(), [
    ['notes/domain/services/note.service.ts', DTO],
    ['notes/domain/services/note.service.ts', `${TS}/update-note.command.ts`],
    [`${TS}/update-note.transaction.script.ts`, DTO],
  ]);
  assert.ok(upward(m).items.includes(`The domain takes a DTO: ${TS}/update-note.transaction.script.ts -> ${DTO}`));
});

test('with nothing broken, each rule is listed with its patterns', () => {
  const m = scan(cfgWith([
    { from: ['repository', 'cache'], to: ['dto', 'swagger'], why: 'x' },
    { from: ['aggregator'], to: 'service', why: 'y' },
  ]), { files: TREE });
  assert.strictEqual(upward(m).tone, 'good');
  assert.deepStrictEqual(upward(m).items, ['{repository,cache} -> {dto,swagger}: 0', 'aggregator -> service: 0']);
});

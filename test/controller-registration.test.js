'use strict';
/**
 * A controller no module lists in `controllers` has routes Nest never
 * serves. Fixture-free: in-memory backends.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const { violationsOf } = require('../src/violations');

const action = (cls, verb, route) => `import { Controller, ${verb} } from '@nestjs/common';
@Controller('notes')
export class ${cls} {
  @${verb}(${route ? `'${route}'` : ''})
  apply() { return null; }
}
`;
const BASE = {
  'notes/apps/actions/create-note.action.ts': action('CreateNoteAction', 'Post', ''),
  'notes/apps/actions/delete-note.action.ts': action('DeleteNoteAction', 'Delete', ':id'),
  // a module that imports DeleteNoteAction and does not list it: the regression it guards
  'notes/notes.module.ts': `import { Module } from '@nestjs/common';
import { CreateNoteAction } from './apps/actions/create-note.action';
import { DeleteNoteAction } from './apps/actions/delete-note.action';
// controllers: [DeleteNoteAction]  (a comment is not a list)
@Module({ controllers: [CreateNoteAction] })
export class NotesModule {}
`,
  'users/apps/controllers/users.controller.ts': `import { Controller, Get } from '@nestjs/common';
@Controller('users')
export class UsersController {
  @Get()
  list() { return []; }
}
`,
  // `controllers` in an import path; the root module, whose pattern is bootstrap
  'app.module.ts': `import { Module } from '@nestjs/common';
import { NotesModule } from './notes/notes.module';
import { UsersController } from './users/apps/controllers/users.controller';
@Module({
  imports: [NotesModule],
  controllers: [UsersController],
})
export class AppModule {}
`,
};
const cfg = Object.assign({}, nestjs, { name: 'be', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react-backend') });
const run = (files) => scan(cfg, { files });

test('a route on a controller no module lists is unregistered; the rest are untouched', () => {
  const m = run(BASE);
  const del = m.endpoints.find((e) => e.cls === 'DeleteNoteAction');
  assert.strictEqual(del.unregistered, true);
  for (const e of m.endpoints.filter((x) => x !== del)) assert.ok(!('unregistered' in e), e.id);
});

test('the finding names the class and its routes, and is a violation check can gate', () => {
  const m = run(BASE);
  const f = m.findings.find((x) => x.id === 'controller-unregistered');
  assert.strictEqual(f.title, "1 controller is in no module's controllers: 1 route not served");
  assert.deepStrictEqual(f.items, ['notes/apps/actions/delete-note.action.ts DeleteNoteAction: DELETE /notes/:id']);
  assert.deepStrictEqual(violationsOf(m).filter((v) => v.rule === 'controller-unregistered').map((v) => [v.from, v.to]),
    [['notes/apps/actions/delete-note.action.ts', 'DeleteNoteAction']]);
});

test('listed, it is registered', () => {
  const m = run(Object.assign({}, BASE, {
    'notes/notes.module.ts': BASE['notes/notes.module.ts'].replace('controllers: [CreateNoteAction]', 'controllers: [CreateNoteAction, DeleteNoteAction]'),
  }));
  assert.ok(m.endpoints.every((e) => !e.unregistered));
  assert.ok(!m.findings.some((x) => x.id === 'controller-unregistered'));
});

test('a list it cannot read, or no lists at all: nothing is flagged', () => {
  const spread = run(Object.assign({}, BASE, {
    'notes/notes.module.ts': BASE['notes/notes.module.ts'].replace('controllers: [CreateNoteAction]', 'controllers: [...ACTIONS]'),
  }));
  assert.ok(spread.endpoints.every((e) => !e.unregistered), 'a spread could hold anything');
  const shorthand = run(Object.assign({}, BASE, {
    'notes/notes.module.ts': BASE['notes/notes.module.ts'].replace('controllers: [CreateNoteAction]', 'controllers'),
  }));
  assert.ok(shorthand.endpoints.every((e) => !e.unregistered), 'a shorthand names a variable');
  const none = run({ 'notes/apps/actions/delete-note.action.ts': BASE['notes/apps/actions/delete-note.action.ts'] });
  assert.ok(none.endpoints.every((e) => !e.unregistered), 'a tree with no module says nothing');
});

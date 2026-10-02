'use strict';
/**
 * Spec 15 — reading a type expression into a shape: fields and optionality,
 * arrays, nothing; anything else unread.
 */
const test = require('node:test');
const assert = require('node:assert');
const { shapeOf } = require('../src/shapes');

const keys = (s) => Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.optional]));

test('an object literal type: fields, optional marks, index signatures open it', () => {
  assert.deepStrictEqual(keys(shapeOf('{ name: string; parentId?: number | null }')), { name: false, parentId: true });
  assert.strictEqual(shapeOf('{ id: number; [k: string]: unknown }').open, true);
  assert.deepStrictEqual(keys(shapeOf('{ a: Map<string, number>, b?: { c: string } }')), { a: false, b: true });
});

test('Promise unwraps; void and friends are nothing', () => {
  assert.deepStrictEqual(keys(shapeOf('Promise<{ success: boolean }>')), { success: false });
  assert.deepStrictEqual(shapeOf('Promise<void>'), { none: true });
  assert.deepStrictEqual(shapeOf('undefined'), { none: true });
});

test('arrays: T[] and Array<T>', () => {
  assert.deepStrictEqual(keys(shapeOf('{ id: number }[]').array), { id: false });
  assert.deepStrictEqual(keys(shapeOf('Array<{ id: number }>').array), { id: false });
  assert.deepStrictEqual(shapeOf('Promise<Unknown[]>'), { array: null });
});

test('Partial makes every field optional; & merges; T | null is T', () => {
  assert.deepStrictEqual(keys(shapeOf('Partial<{ a: string; b: number }>')), { a: true, b: true });
  assert.deepStrictEqual(keys(shapeOf('{ a: string } & { b?: number }')), { a: false, b: true });
  assert.deepStrictEqual(keys(shapeOf('{ a: string } | null')), { a: false });
});

test('names go through the lookup; what cannot be read is null', () => {
  const lookup = (n) => (n === 'Thing' ? { fields: { id: { optional: false, type: 'number' } }, open: false } : null);
  assert.deepStrictEqual(keys(shapeOf('Promise<Thing[]>', lookup).array), { id: false });
  assert.strictEqual(shapeOf('Nope', lookup), null);
  assert.strictEqual(shapeOf('string | number'), null, 'a real union');
  assert.strictEqual(shapeOf('Record<string, Thing>', lookup), null, 'a generic of our own');
  assert.strictEqual(shapeOf('T extends U ? X : Y'), null);
});

// ---------------------------------------------------------------- named types
const { typeIndex, lookupIn } = require('../src/shapes');

const TEXT = {
  'dtos/create-note.dto.ts': `import { IsOptional, IsString } from 'class-validator';
export class CreateNoteDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsOptional() folderId?: number;

  constructor(name: string) { this.name = name; }

  describe(): string {
    const note: string = this.name;
    return note;
  }
}
export class ImportNoteDto extends CreateNoteDto {
  source: string;
}`,
  'api/types.ts': `export type Note = {
  id: number;
  name: string;
  pinned?: boolean;
};
export interface Tagged extends Base {
  tags: string[];
}
export interface Base { id: number }
export type NoteList = Note[];
export type Maybe = Note | null;
export type Box<T> = { value: T };`,
  'a/dup.ts': 'export type Dup = { a: string };',
  'b/dup.ts': 'export type Dup = { b: string };',
};
const idx = typeIndex(TEXT);
const look = lookupIn(idx);

test('a class DTO: fields at the top level only; @IsOptional and ? make a field optional', () => {
  assert.deepStrictEqual(keys(look('CreateNoteDto')), { name: false, description: true, folderId: true });
});

test('extends: a class inherits its base fields, an interface its bases', () => {
  assert.deepStrictEqual(keys(look('ImportNoteDto')), { name: false, description: true, folderId: true, source: false });
  assert.deepStrictEqual(keys(look('Tagged')), { id: false, tags: false });
});

test('type aliases: object, array, union with null', () => {
  assert.deepStrictEqual(keys(look('Note')), { id: false, name: false, pinned: true });
  assert.deepStrictEqual(keys(look('NoteList').array), { id: false, name: false, pinned: true });
  assert.deepStrictEqual(keys(look('Maybe')), { id: false, name: false, pinned: true });
  assert.strictEqual(look('Box'), null, 'a generic alias is not indexed');
});

test('a name defined twice is unread, unless the caller says which file it means', () => {
  assert.strictEqual(look('Dup'), null);
  assert.deepStrictEqual(keys(lookupIn(idx, (n) => (n === 'Dup' ? { file: 'b/dup.ts', name: 'Dup' } : null))('Dup')), { b: false });
});

test('where a file gets a name: renamed on import, from a package, and from the declaring file', () => {
  const T = Object.assign({}, TEXT, {
    'b/list.ts': "import { Dup } from './dup';\nexport type DupList = Dup[];",
    'shared/note.ts': 'export type Note = { id: number; title: string };',
  });
  // what each file imports, as contracts' importedFrom would say
  const imports = {
    'b/list.ts': { Dup: { file: 'b/dup.ts', name: 'Dup' } },
    'page.ts': { Row: { file: 'api/types.ts', name: 'Note' }, DupList: { file: 'b/list.ts', name: 'DupList' }, Base: { external: true } },
  };
  const where = (n, f) => (imports[f] || {})[n] || null;
  const look2 = lookupIn(typeIndex(T), where, 'page.ts');
  assert.deepStrictEqual(keys(look2('Row')), { id: false, name: false, pinned: true }, '`Note as Row`, from its file');
  assert.strictEqual(look2('Base'), null, "a package's type, though the tree has one of that name");
  assert.deepStrictEqual(keys(look2('DupList').array), { b: false }, "DupList's own Dup, through b/list.ts's import");
});

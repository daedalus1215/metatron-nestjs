'use strict';
/**
 * Spec 09 — the declaration walker. Every class is read inside its own body,
 * and braces in literals never end one early.
 */
const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../src/classes');

const names = (list) => list.map((x) => x.name);
const member = (cls, name) => cls.members.find((m) => m.name === name);

test('two classes in one file each keep their own constructor', () => {
  const { classes } = parse([
    '@Injectable()',
    'export class A {',
    '  constructor(private readonly b: B) {}',
    '  run() { return this.b.go(); }',
    '}',
    '',
    '@Injectable()',
    'export class C {',
    '  constructor(private readonly d: D, private readonly e: E) {}',
    '}',
  ].join('\n'));
  assert.deepStrictEqual(names(classes), ['A', 'C']);
  assert.deepStrictEqual(classes.map((c) => [c.start, c.end]), [[1, 5], [7, 10]]);
  assert.deepStrictEqual(classes.map((c) => c.decorators), [['Injectable'], ['Injectable']]);
  const ctor = (c) => member(c, 'constructor');
  assert.match(ctor(classes[0]).sig, /b: B\)$/);
  assert.match(ctor(classes[1]).sig, /d: D, private readonly e: E\)$/);
});

test('braces inside strings, templates, regexes and comments do not end a class', () => {
  const { classes } = parse([
    'export class Tricky {',
    "  a() { return '}'; }",
    '  b() { return `${"}"} }`; }',
    '  c() { return /\\}+/.test("x"); }',
    '  // }',
    '  /* } */',
    '  d() { return 1; }',
    '}',
    'export class After {}',
  ].join('\n'));
  assert.deepStrictEqual(names(classes), ['Tricky', 'After']);
  assert.deepStrictEqual(names(classes[0].members), ['a', 'b', 'c', 'd']);
  assert.strictEqual(classes[0].end, 8);
});

test('members: access, static, async, arrows, accessors, abstract', () => {
  const [cls] = parse([
    'export abstract class S extends Base<T> implements P {',
    '  private readonly logger = new Logger(S.name);',
    '  static of(x: number): S { return new S(); }',
    '  async load(id: number): Promise<{ id: number }> { return { id }; }',
    '  protected helper() {}',
    '  #secret() {}',
    '  save = async (x: Thing): Promise<void> => { await this.repo.save(x); };',
    '  short = (x: number) => x * 2;',
    '  get size(): number { return 1; }',
    '  set size(v: number) {}',
    '  get() { return 1; }',
    '  abstract build(): void;',
    '  over(a: string): void;',
    '  over(a: any) {}',
    '}',
  ].join('\n')).classes;
  assert.strictEqual(cls.extends, 'Base');
  assert.strictEqual(cls.abstract, true);
  const pick = (m) => [m.name, m.kind, m.access, m.static, m.async, m.abstract];
  assert.deepStrictEqual(cls.members.map(pick), [
    ['of', 'method', 'public', true, false, false],
    ['load', 'method', 'public', false, true, false],
    ['helper', 'method', 'protected', false, false, false],
    ['#secret', 'method', 'private', false, false, false],
    ['save', 'arrow', 'public', false, true, false],
    ['short', 'arrow', 'public', false, false, false],
    ['size', 'get', 'public', false, false, false],
    ['size', 'set', 'public', false, false, false],
    ['get', 'method', 'public', false, false, false],
    ['build', 'method', 'public', false, false, true],
    ['over', 'method', 'public', false, false, true],
    ['over', 'method', 'public', false, false, false],
  ]);
  assert.strictEqual(member(cls, 'load').sig, 'load(id: number): Promise<{ id: number }>');
  assert.strictEqual(member(cls, 'save').sig, 'save(x: Thing): Promise<void>');
});

test('decorated route handlers keep their decorators and line range', () => {
  const [cls] = parse([
    '@Controller("things")',
    'export class ThingAction {',
    '  constructor(private readonly svc: ThingService) {}',
    '',
    '  @Get(":id")',
    '  @UseGuards(AuthGuard)',
    '  async execute(@Param("id") id: number) {',
    '    return this.svc.find(id);',
    '  }',
    '}',
  ].join('\n')).classes;
  const m = member(cls, 'execute');
  assert.deepStrictEqual(m.decorators, ['Get', 'UseGuards']);
  assert.deepStrictEqual([m.start, m.end], [5, 9]);
});

test('top-level functions: declarations, arrows, function expressions', () => {
  const { functions, classes } = parse([
    "import { x } from './x';",
    'const LIMIT = a < b;',
    'export function one(a: number): number { return a; }',
    'export const two = (a: string) => a.trim();',
    'export const three = async (a: number): Promise<number> => {',
    '  return a;',
    '};',
    'export const four = function (a) { return a; };',
    'function local() {}',
    'export const notAFunction = { a: 1 };',
    'export class Last {}',
  ].join('\n'));
  assert.deepStrictEqual(functions.map((f) => [f.name, f.exported, f.async, f.start, f.end]), [
    ['one', true, false, 3, 3],
    ['two', true, false, 4, 4],
    ['three', true, true, 5, 7],
    ['four', true, false, 8, 8],
    ['local', false, false, 9, 9],
  ]);
  assert.strictEqual(functions[0].sig, 'one(a: number): number');
  assert.deepStrictEqual(names(classes), ['Last'], 'a comparison at top level must not swallow the file');
});

test('interfaces: method signatures and arrow-typed properties, not fields', () => {
  const { interfaces } = parse([
    "export const THING_PORT = Symbol('THING_PORT');",
    'export interface ThingPort {',
    '  find(id: number): Promise<Thing>;',
    '  remove: (id: number) => Promise<void>;',
    '  readonly name: string;',
    '  count?(): number;',
    '}',
  ].join('\n'));
  assert.deepStrictEqual(interfaces.map((i) => i.name), ['ThingPort']);
  assert.deepStrictEqual(interfaces[0].members.map((m) => [m.name, m.sig]), [
    ['find', 'find(id: number): Promise<Thing>'],
    ['remove', 'remove: (id: number) => Promise<void>'],
    ['count', 'count(): number'],
  ]);
});

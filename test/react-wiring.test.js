'use strict';
/**
 * Spec 12 — the React wiring model: components, hooks and contexts as
 * bricks; hooks and contexts used as sockets; renders, mounts, hook and
 * context calls, function calls and HTTP calls as connections; routes.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const { load } = require('../src/config');

const model = scan(load(path.join(__dirname, 'fixtures', 'react')));
const brick = (id) => model.bricks.find((b) => b.id === id);
const sockets = (id) => brick(id).sockets.map((s) => [s.prop, s.status]);
const calls = (kind) => model.calls.filter((c) => c.kind === kind);
const grip = (id) => brick(id).studs[0].grip;

const HEADER = 'components/Header/Header.tsx#Header';
const LAYOUT = 'components/Layout/Layout.tsx#Layout';
const THINGS = 'pages/ThingsPage/ThingsPage.tsx#ThingsPage';
const THING = 'pages/ThingPage/ThingPage.tsx#ThingPage';
const ROW = 'pages/ThingsPage/components/ThingRow.tsx#ThingRow';
const CTX = 'contexts/SidebarContext.tsx#SidebarContext';
const REQ = 'api/requests/things.requests.ts';

test('bricks: components (wrapped ones too), hooks, contexts, function files, the script', () => {
  const shape = Object.fromEntries(model.bricks.map((b) => [b.id, b.shape]));
  assert.strictEqual(shape[HEADER], 'component');
  assert.strictEqual(shape[ROW], 'component');
  assert.strictEqual(brick(ROW).wrapped, 'memo');
  assert.strictEqual(shape['hooks/useSidebar.ts#useSidebar'], 'hook');
  assert.strictEqual(shape[CTX], 'context');
  assert.strictEqual(shape['contexts/SidebarContext.tsx#SidebarProvider'], 'component');
  assert.strictEqual(shape[REQ], 'functions');
  assert.strictEqual(shape['main.tsx'], 'script');
});

test('tiers: a page on the Page row, hooks on the Hook row wherever they live', () => {
  const tier = (id) => model.tiers[brick(id).tier].name;
  assert.deepStrictEqual([tier('App.tsx#App'), tier(THINGS), tier(HEADER), tier('hooks/useSidebar.ts#useSidebar'), tier(CTX), tier(REQ)],
    ['Route', 'Page', 'Component', 'Hook', 'State', 'Request']);
});

test('sockets: hooks and contexts used, in the tree, from a package, or nowhere', () => {
  assert.deepStrictEqual(sockets(HEADER), [['useSidebar', 'resolved']]);
  assert.deepStrictEqual(sockets('hooks/useSidebar.ts#useSidebar'), [['SidebarContext', 'resolved']]);
  assert.deepStrictEqual(sockets(THING), [
    ['useParams', 'framework'], ['useState', 'framework'], ['useEffect', 'framework'],
    ['useMissingHook', 'unresolved'], ['useThingName', 'resolved']]);
  assert.strictEqual(brick(THING).sockets[0].from, 'react-router-dom');
  // the missing file is already an import-unresolved diagnostic, not a second one
  assert.ok(!model.diagnostics.some((d) => d.kind === 'socket-unresolved'));
});

test('a component offers its render, with its props', () => {
  const s = brick(ROW).studs[0];
  assert.deepStrictEqual([s.name, s.sig, s.props, s.propsType], ['render', '<ThingRow thing onPick />', ['thing', 'onPick'], 'ThingRowProps']);
  assert.strictEqual(brick(HEADER).studs[0].propsType, 'HeaderProps');
});

test('renders and mounts: a route mounts its page, and the route grips it', () => {
  assert.deepStrictEqual(calls('render').filter((c) => c.from === THINGS).map((c) => c.to).sort(), [HEADER, ROW]);
  assert.deepStrictEqual(calls('mount').map((c) => c.to).sort(), [LAYOUT, THING, THING, THINGS, THINGS]);
  assert.deepStrictEqual([grip(THINGS), grip(THING), grip(LAYOUT), grip(HEADER)], ['route', 'route', 'route', 'brick']);
  assert.strictEqual(brick(THINGS).studs[0].route, '/things, /about');
});

test('a component passed as a value is used; one named in a comment or a string is not', () => {
  const ref = calls('render').find((c) => c.ref);
  assert.deepStrictEqual([ref.from, ref.to], ['components/Slots/Slots.tsx#Slots', HEADER]);
  assert.strictEqual(grip('components/Unused/Unused.tsx#Unused'), 'unseen');
});

test('hooks, contexts and providers are calls too', () => {
  assert.deepStrictEqual(calls('hook').map((c) => [c.from, c.toMethod]).sort(), [
    [HEADER, 'useSidebar'], [THING, 'useThingName'], [THINGS, 'useThings']]);
  assert.deepStrictEqual(calls('context').map((c) => [c.from, c.to]), [['hooks/useSidebar.ts#useSidebar', CTX]]);
  assert.deepStrictEqual(calls('provide').map((c) => c.from), ['contexts/SidebarContext.tsx#SidebarProvider']);
});

test('a function is used when it is called or passed', () => {
  assert.deepStrictEqual(calls('call').map((c) => [c.from.split('#')[1], c.toMethod, !!c.ref]).sort(), [
    ['ThingPage', 'fetchThing', false], ['ThingRow', 'deleteThing', false], ['useThings', 'fetchThings', true]]);
  assert.deepStrictEqual(brick(REQ).studs.map((s) => [s.name, s.grip]), [
    ['fetchThings', 'brick'], ['fetchThing', 'brick'], ['deleteThing', 'brick'], ['renameThing', 'unseen'], ['pingMissing', 'unseen'],
    ['fetchView', 'unseen'], ['fetchBuilt', 'unseen']]);
});

test('HTTP: every call through the client, with its verb and URL, helpers included', () => {
  assert.deepStrictEqual(calls('http').map((c) => [c.fromMethod, c.verb, c.path]).sort(), [
    ['deleteThing', 'DELETE', '/api/things/${id}'],
    ['fetchBuilt', 'GET', null],
    ['fetchName', 'GET', '/things/${id}/name'],
    ['fetchThing', 'GET', '/things/${id}'],
    ['fetchThings', 'GET', '/things?sort=name'],
    ['fetchView', 'GET', '/views/${view}'],
    ['pingMissing', 'GET', '/nowhere'],
    ['renameThing', 'PATCH', '/things/${id}/name'],
  ]);
  assert.deepStrictEqual(brick('pages/ThingPage/hooks/useThingName.ts').internals.map((s) => [s.name, s.http.length]), [['fetchName', 1]]);
});

test('routes: literal and constant paths, nesting joined, a computed path kept and reported', () => {
  assert.deepStrictEqual(model.routes.map((r) => [r.path, r.element, !!r.layout]), [
    ['/', 'Layout', true], ['/things', 'ThingsPage', false], ['/things/:id', 'ThingPage', false],
    ['/about', 'ThingsPage', false], [null, 'ThingPage', false]]);
  assert.ok(model.diagnostics.some((d) => d.kind === 'route-path-unread' && d.line === 17));
});

test('wiringMeta counts it all', () => {
  const W = model.wiringMeta;
  assert.deepStrictEqual([W.sockets, W.framework, W.unresolved, W.renders, W.http.calls, W.http.unread], [12, 7, 1, 7, 8, 1]);
  assert.deepStrictEqual(W.studs, { total: 20, brick: 12, route: 3, framework: 0, unseen: 5 });
});

test("a file's loose functions beside a component of the file's name take the file's full name", () => {
  const react = require('../src/defaults/react');
  const m = scan(Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react') }), { files: {
    'components/Panel.tsx': "const label = (n: number) => `#${n}`;\nexport const Panel = () => <div>{label(1)}</div>;\n",
    'api/notes.requests.ts': 'export const fetchNotes = async () => [];\n',
  } });
  const names = (file) => m.bricks.filter((b) => b.file === file).map((b) => [b.shape, b.name]).sort();
  assert.deepStrictEqual(names('components/Panel.tsx'), [['component', 'Panel'], ['functions', 'Panel.tsx']]);
  assert.deepStrictEqual(names('api/notes.requests.ts'), [['functions', 'notes.requests']], 'no collision, no change');
});

'use strict';
/**
 * Spec 12 — scanning a React frontend: the `react` profile, .tsx, import
 * aliases, and imports that name no file.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const { load } = require('../src/config');

const cfg = load(path.join(__dirname, 'fixtures', 'react'));
const model = scan(cfg);
const pattern = (f) => (model.fileNodes.find((n) => n.f === f) || {}).p;
const linked = (a, b) => model.fileLinks.some((l) => model.fileNodes[l[0]].f === a && model.fileNodes[l[1]].f === b);

test('the react profile classifies every file, .tsx included', () => {
  assert.strictEqual(model.coverage.unclassifiedCount, 0);
  assert.deepStrictEqual([
    pattern('App.tsx'), pattern('main.tsx'), pattern('pages/ThingsPage/ThingsPage.tsx'),
    pattern('pages/ThingsPage/components/ThingRow.tsx'), pattern('components/Header/Header.tsx'),
    pattern('pages/ThingsPage/hooks/useThings.ts'), pattern('hooks/useSidebar.ts'),
    pattern('contexts/SidebarContext.tsx'), pattern('api/requests/things.requests.ts'),
    pattern('constants/routes.ts'),
  ], ['router', 'bootstrap', 'page', 'component', 'component', 'hook', 'hook', 'context', 'request', 'constants']);
});

test('aliases and explicit extensions resolve', () => {
  assert.ok(linked('pages/ThingsPage/hooks/useThings.ts', 'api/requests/things.requests.ts'), '@/api/…');
  assert.ok(linked('pages/ThingsPage/ThingsPage.tsx', 'components/Header/Header.tsx'), '@/components/…');
  assert.ok(linked('main.tsx', 'App.tsx'), './App.tsx');
});

test('a local import that names no file is a diagnostic; a stylesheet is not', () => {
  const d = model.diagnostics.filter((x) => x.kind === 'import-unresolved');
  assert.deepStrictEqual(d.map((x) => [x.file, x.line]), [['pages/ThingPage/ThingPage.tsx', 4]]);
  assert.match(d[0].detail, /'\.\/hooks\/useMissingHook' names no file/);
});

test('a component importing the request layer skips the hook', () => {
  const skip = model.fileLinks.filter((l) => l[3] === 'component>request')
    .map((l) => model.fileNodes[l[0]].f);
  assert.deepStrictEqual(skip.sort(), ['pages/ThingPage/ThingPage.tsx', 'pages/ThingsPage/components/ThingRow.tsx']);
});

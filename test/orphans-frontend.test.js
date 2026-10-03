'use strict';
/**
 * On a frontend, reachability starts at the app's entry (main.tsx), and a
 * lazy `import()` counts. Before this, a frontend had no roots and nearly
 * every file was an orphan.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const react = require('../src/defaults/react');

const cfg = Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react') });
const FILES = {
  'main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.body).render(<App />);\n",
  'App.tsx': "import { lazy } from 'react';\nimport Home from './pages/Home/Home';\nconst Later = lazy(() => import('./pages/Later/Later'));\nexport default function App() { return <><Home /><Later /></>; }\n",
  'pages/Home/Home.tsx': "import { Card } from '../../components/Card';\nexport default function Home() { return <Card />; }\n",
  'pages/Later/Later.tsx': 'export default function Later() { return <div />; }\n',
  'components/Card.tsx': 'export const Card = () => <div />;\n',
  'components/Dead.tsx': 'export const Dead = () => <div />;\n',
};
const orphansOf = (files) => scan(cfg, { files }).findings.find((f) => f.id === 'orphans');

test("a frontend's orphans are the files its entry never reaches; a lazy import counts", () => {
  const f = orphansOf(FILES);
  assert.deepStrictEqual(f.items, ['components/Dead.tsx']);
  assert.strictEqual(f.title, "1 file is unreachable from the app's entry");
  assert.match(f.detail, /outward from main\.tsx/);
});

test('with no entry in the tree, nothing is said to be unreachable', () => {
  const files = Object.assign({}, FILES);
  delete files['main.tsx'];
  assert.strictEqual(orphansOf(files), undefined);
});

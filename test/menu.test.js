'use strict';
/**
 * `metatron-nest menu`: every choice ends as an argv the CLI already accepts.
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/menu');

const HOME = '/home/me';
const action = (id) => M.ACTIONS.find((a) => a.id === id);
const argv = (id, values, project) => M.argvFor(action(id), Object.assign(M.defaultsOf(action(id)), values), project);

test('each command, left at its defaults, is the bare command from --help', () => {
  assert.deepStrictEqual(argv('build'), []);
  assert.deepStrictEqual(argv('scan'), ['scan']);
  assert.deepStrictEqual(argv('serve'), ['serve']);
  assert.deepStrictEqual(argv('views'), ['views']);
  assert.deepStrictEqual(argv('check'), ['check']);
  assert.deepStrictEqual(argv('baseline'), ['baseline']);
  assert.deepStrictEqual(argv('diff'), ['diff']);
  assert.deepStrictEqual(argv('skill'), ['skill']);
  assert.deepStrictEqual(argv('help'), ['--help']);
});

test('fields become the flags the CLI parses', () => {
  assert.deepStrictEqual(argv('serve', { port: '5000', watch: false }), ['serve', '--port', '5000', '--no-watch']);
  assert.deepStrictEqual(argv('views', { lens: 'layers' }), ['views', 'layers']);
  assert.deepStrictEqual(argv('check', { rule: 'orphans, circular', allowNew: '3', fixed: false, json: true }),
    ['check', '--rule', 'orphans', '--rule', 'circular', '--allow-new', '3', '--no-fixed', '--json']);
  assert.deepStrictEqual(argv('baseline', { update: true }), ['baseline', '--update']);
  assert.deepStrictEqual(argv('diff', { range: 'main...HEAD', format: 'markdown' }), ['diff', 'main...HEAD', '--format', 'markdown']);
  assert.deepStrictEqual(argv('skill', { dest: '~/skills', where: true }), ['skill', '--dest', '~/skills', '--where']);
});

test('--staged replaces a range, since the CLI would ignore the range', () => {
  assert.deepStrictEqual(argv('diff', { range: 'main...HEAD', staged: true }), ['diff', '--staged']);
});

test('the views offered are the templates that exist', () => {
  const lens = action('views').fields[0];
  assert.strictEqual(lens.options[0], 'all');
  assert.ok(lens.options.includes('layers') && lens.options.includes('atlas'));
  assert.ok(!lens.options.some((o) => o.endsWith('.html')));
});

test('the path is passed only when the CLI would not find the project itself', () => {
  assert.deepStrictEqual(argv('scan', {}, { dir: '/p/api', here: false }), ['scan', '/p/api']);
  assert.deepStrictEqual(argv('scan', {}, { dir: '/p/api', here: true }), ['scan']);
  assert.deepStrictEqual(argv('skill', {}, { dir: '/p/api', here: false }), ['skill'], 'skill reads no project');
});

test('the command line shortens home and quotes what a shell would split', () => {
  assert.strictEqual(M.commandLine(['serve', HOME + '/code/api'], HOME), 'metatron-nest serve ~/code/api');
  assert.strictEqual(M.commandLine(['diff', 'main...HEAD^'], HOME), 'metatron-nest diff main...HEAD^');
  assert.strictEqual(M.commandLine(['scan', '/p/my api'], HOME), "metatron-nest scan '/p/my api'");
  assert.strictEqual(M.commandLine(['scan', "/p/it's"], HOME), `metatron-nest scan '/p/it'\\''s'`);
});

'use strict';
/**
 * `metatron-nest menu`: every choice ends as an argv the CLI already accepts.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../src/menu');

/** A throwaway tree: each path is a file, made along with its parents. */
function tree(...files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'metatron-menu-')));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), '');
  }
  return dir;
}

const HOME = '/home/me';
const action = (id) => M.ACTIONS.find((a) => a.id === id);
const argv = (id, values, project) => M.argvFor(action(id), Object.assign(M.defaultsOf(action(id)), values), project);

/** Keys by name (`down`, `return`), or one character at a time for anything else. */
const key = (k) => {
  if (typeof k !== 'string') return k;
  if (k.length > 1) return { name: k, str: k === 'space' ? ' ' : undefined };
  return { name: /[a-z0-9]/.test(k) ? k : undefined, str: k };
};
const press = (s, ctx, ...keys) => keys.reduce((st, k) => M.update(st, key(k), ctx), s);
const typed = (text) => [...text];

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

test('discover finds configs below the roots, under any of their names', () => {
  const dir = tree('a/backend/arch.config.js', 'a/frontend/arch.config.cjs', 'b/arch.config.mjs', 'c/notes.md');
  try {
    assert.deepStrictEqual(M.discover([dir]), [
      path.join(dir, 'a/backend'), path.join(dir, 'a/frontend'), path.join(dir, 'b'),
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('discover skips dependencies, output, fixtures and dot directories', () => {
  const dir = tree(
    'node_modules/x/arch.config.js', 'dist/arch.config.js', 'test/fixtures/x/arch.config.js',
    '.git/arch.config.js', 'real/arch.config.js',
  );
  try {
    assert.deepStrictEqual(M.discover([dir]), [path.join(dir, 'real')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('discover stops at its depth and its limit, and lists a shared root once', () => {
  const dir = tree('1/2/arch.config.js', '1/2/3/4/arch.config.js');
  try {
    assert.deepStrictEqual(M.discover([dir], 2), [path.join(dir, '1/2')]);
    assert.deepStrictEqual(M.discover([dir], 3, 1), [], 'the limit is reached before anything is read below the root');
    assert.deepStrictEqual(M.discover([dir, path.join(dir, '1')], 2), [path.join(dir, '1/2')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('expand reads ~ and relative paths the way a shell would', () => {
  const ctx = { cwd: '/work/here', home: HOME };
  assert.strictEqual(M.expand('~', ctx), HOME);
  assert.strictEqual(M.expand('~/api', ctx), HOME + '/api');
  assert.strictEqual(M.expand('api', ctx), '/work/here/api');
  assert.strictEqual(M.expand('/abs', ctx), '/abs');
  assert.strictEqual(M.expand('~other/api', ctx), '/work/here/~other/api');
});

test('completeDir finishes one match and stops where several disagree', () => {
  const dir = tree('chronus/x', 'chronicle/x', 'omega/x', 'chrome.txt');
  const ctx = { cwd: dir, home: dir };
  try {
    assert.deepStrictEqual(M.completeDir('o', ctx), { text: 'omega/', matches: [] });
    assert.deepStrictEqual(M.completeDir('ch', ctx), { text: 'chron', matches: ['chronicle', 'chronus'] });
    assert.deepStrictEqual(M.completeDir('~/o', ctx), { text: '~/omega/', matches: [] }, 'what was typed is kept');
    assert.deepStrictEqual(M.completeDir('nope', ctx), { text: 'nope', matches: [] });
    assert.deepStrictEqual(M.completeDir('no/such/', ctx), { text: 'no/such/', matches: [] });
    assert.deepStrictEqual(M.completeDir('', ctx).matches, ['chronicle', 'chronus', 'omega']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('completeDir leaves ~ and .. as paths, not the names they resolve to', () => {
  const dir = tree('home/me/api/x', 'home/you/x');
  const ctx = { cwd: path.join(dir, 'home/me'), home: path.join(dir, 'home/me') };
  try {
    assert.deepStrictEqual(M.completeDir('~', ctx), { text: '~/', matches: [] });
    assert.deepStrictEqual(M.completeDir('~/a', ctx), { text: '~/api/', matches: [] });
    assert.deepStrictEqual(M.completeDir('..', ctx), { text: '..', matches: [] });
    assert.deepStrictEqual(M.completeDir('../y', ctx), { text: '../you/', matches: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a config at or above where it started is the project, and needs no path', () => {
  const dir = tree('api/arch.config.js', 'api/src/x.ts');
  try {
    const s = M.init({ cwd: path.join(dir, 'api/src'), home: HOME });
    assert.strictEqual(s.screen, 'menu');
    assert.deepStrictEqual(s.project, { dir: path.join(dir, 'api'), here: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with no config in reach it opens on the projects it can see, parent included', () => {
  const dir = tree('here/x', 'near/backend/arch.config.js');
  const ctx = { cwd: path.join(dir, 'here'), home: HOME };
  try {
    const s = M.init(ctx);
    assert.strictEqual(s.screen, 'projects');
    assert.deepStrictEqual(s.projects, [path.join(dir, 'near/backend')]);
    const chosen = press(s, ctx, 'return');
    assert.strictEqual(chosen.screen, 'menu');
    assert.deepStrictEqual(chosen.project, { dir: path.join(dir, 'near/backend'), here: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('moving wraps both ways, by arrows or j and k', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: null, values: {}, matches: [], message: '' };
  assert.strictEqual(press(s, ctx, 'up').cursor, M.ROWS.length - 1);
  assert.strictEqual(press(s, ctx, 'up', 'down').cursor, 0);
  assert.strictEqual(press(s, ctx, 'j', 'j', 'k').cursor, 1);
});

test('a command with no options runs at once, by Enter or by its letter', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: { dir: '/p/api', here: false }, values: {}, matches: [], message: '' };
  assert.deepStrictEqual(press(s, ctx, 'return').run, ['/p/api']);
  const scan = press(s, ctx, 's');
  assert.deepStrictEqual(scan.run, ['scan', '/p/api']);
  assert.strictEqual(M.ROWS[scan.cursor].id, 'scan', 'the cursor follows the letter');
  assert.strictEqual(press(s, ctx, 'x').run, undefined);
  assert.strictEqual(press(s, ctx, { name: 's', ctrl: true }).run, undefined);
});

test('q and Ctrl-C quit from the menu; Esc there does nothing', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: null, values: {}, matches: [], message: '' };
  assert.strictEqual(press(s, ctx, 'q').quit, true);
  assert.strictEqual(press(s, ctx, { name: 'c', ctrl: true }).quit, true);
  assert.strictEqual(press(s, ctx, 'escape').quit, undefined);
});

test('a command that reads a project asks for one first; one that does not, does not', () => {
  const dir = tree('x');
  const ctx = { cwd: dir, home: HOME };
  const s = { screen: 'menu', cursor: 0, project: null, values: {}, matches: [], message: '' };
  try {
    const asked = press(s, ctx, 'b');
    assert.strictEqual(asked.screen, 'projects');
    assert.match(asked.message, /Build reads a project/);
    assert.strictEqual(asked.run, undefined);
    assert.deepStrictEqual(press(s, ctx, 'h').run, ['--help']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('choosing again starts on the current project and keeps it when it was typed', () => {
  const dir = tree('a/arch.config.js', 'b/arch.config.js', 'far/away/arch.config.js');
  const ctx = { cwd: dir, home: HOME };
  try {
    let s = { screen: 'menu', cursor: 0, project: { dir: path.join(dir, 'b'), here: false }, values: {}, matches: [], message: '' };
    assert.strictEqual(press(s, ctx, 'p').pick, 1);
    assert.strictEqual(press(s, ctx, 'p', 'escape').project.dir, path.join(dir, 'b'));
    s = { ...s, project: { dir: '/elsewhere/api', here: false } };
    assert.strictEqual(press(s, ctx, 'p').projects[0], '/elsewhere/api');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a typed path is checked, and may sit anywhere below a config', () => {
  const dir = tree('home/api/arch.config.js', 'home/api/src/x.ts', 'home/empty/x', 'cwd/x');
  const ctx = { cwd: path.join(dir, 'cwd'), home: path.join(dir, 'home') };
  try {
    const s = press(M.init(ctx), ctx, 'up', 'return');
    assert.strictEqual(s.screen, 'path', 'the last row asks for a path');
    assert.match(press(s, ctx, ...typed('~/nope'), 'return').message, /~\/nope does not exist/);
    assert.match(press(s, ctx, ...typed('~/empty'), 'return').message, /no arch\.config\.js at or above ~\/empty/);
    const ok = press(s, ctx, ...typed('~/api/src'), 'return');
    assert.strictEqual(ok.screen, 'menu');
    assert.deepStrictEqual(ok.project, { dir: path.join(dir, 'home/api'), here: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('typing a path: Tab completes, a key clears the matches, Esc steps back', () => {
  const dir = tree('home/api/x', 'home/app/x', 'cwd/x');
  const ctx = { cwd: path.join(dir, 'cwd'), home: path.join(dir, 'home') };
  try {
    const s = press(M.init(ctx), ctx, 'return', ...typed('~/a'));
    const tabbed = press(s, ctx, 'tab');
    assert.strictEqual(tabbed.text, '~/ap');
    assert.deepStrictEqual(tabbed.matches, ['api', 'app']);
    const more = press(tabbed, ctx, 'i');
    assert.strictEqual(more.text, '~/api');
    assert.deepStrictEqual(more.matches, []);
    assert.strictEqual(press(more, ctx, 'backspace').text, '~/ap');
    assert.strictEqual(press(more, ctx, { name: 'u', ctrl: true }).text, '');
    assert.strictEqual(press(more, ctx, 'escape').screen, 'projects');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const inForm = (letter) => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: { dir: '/p/api', here: true }, values: {}, matches: [], message: '' };
  return { ctx, s: press(s, ctx, letter) };
};

test('a command with options opens a form instead of running', () => {
  const { s } = inForm('w');
  assert.strictEqual(s.screen, 'form');
  assert.strictEqual(s.action, 'serve');
  assert.strictEqual(s.run, undefined);
});

test('Enter runs what the form says, from any field', () => {
  const { s, ctx } = inForm('d');
  const done = press(s, ctx, ...typed('main...HEAD'), 'down', 'down', 'right', 'return');
  assert.deepStrictEqual(done.run, ['diff', 'main...HEAD', '--format', 'markdown']);
});

test('a toggle flips on space or an arrow, and ignores letters', () => {
  const { s, ctx } = inForm('l');
  assert.deepStrictEqual(press(s, ctx, 'space', 'return').run, ['baseline', '--update']);
  assert.deepStrictEqual(press(s, ctx, 'space', 'left', 'return').run, ['baseline']);
  assert.deepStrictEqual(press(s, ctx, 'x', 'return').run, ['baseline']);
});

test('a choice cycles through its options both ways', () => {
  const { s, ctx } = inForm('v');
  const last = action('views').fields[0].options.slice(-1)[0];
  assert.deepStrictEqual(press(s, ctx, 'left', 'return').run, ['views', last]);
  assert.deepStrictEqual(press(s, ctx, 'left', 'right', 'return').run, ['views']);
});

test('a number field takes digits only, and a blank one falls back to the default', () => {
  const { s, ctx } = inForm('w');
  assert.deepStrictEqual(press(s, ctx, { name: 'u', ctrl: true }, ...typed('5x0-00'), 'return').run, ['serve', '--port', '5000']);
  assert.deepStrictEqual(press(s, ctx, { name: 'u', ctrl: true }, 'return').run, ['serve']);
});

test('letters that mean something in the menu are text in a form', () => {
  const { s, ctx } = inForm('d');
  const done = press(s, ctx, ...typed('jkq'));
  assert.strictEqual(done.quit, undefined);
  assert.strictEqual(done.field, 0);
  assert.deepStrictEqual(done.values.diff.range, 'jkq');
});

test('Tab moves between fields, except on a path, where it completes', () => {
  const { s, ctx } = inForm('c');
  assert.strictEqual(press(s, ctx, 'tab').field, 1);
  assert.strictEqual(press(s, ctx, { name: 'tab', shift: true }).field, 3);

  const dir = tree('skills/x', 'skins/x');
  const here = { cwd: dir, home: HOME };
  try {
    const skill = press(inForm('i').s, here, ...typed('sk'), 'tab');
    assert.strictEqual(skill.field, 0);
    assert.strictEqual(skill.values.skill.dest, 'ski');
    assert.deepStrictEqual(skill.matches, ['skills', 'skins']);
    assert.deepStrictEqual(press(skill, here, 'down').matches, [], 'matches belong to the field just left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Esc goes back and a form remembers its values for the next run', () => {
  const { s, ctx } = inForm('w');
  const back = press(s, ctx, { name: 'u', ctrl: true }, ...typed('5000'), 'escape');
  assert.strictEqual(back.screen, 'menu');
  assert.strictEqual(back.run, undefined);
  assert.deepStrictEqual(press(back, ctx, 'w', 'return').run, ['serve', '--port', '5000']);
});

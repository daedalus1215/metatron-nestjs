'use strict';
/**
 * `metatron-nest menu`: every choice ends as an argv the CLI already accepts.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const M = require('../src/menu');

const BIN = path.join(__dirname, '..', 'bin', 'metatron.js');

/**
 * A throwaway tree: each path is a file, made along with its parents. A test
 * that opens the project list starts in a directory inside it, because the list
 * looks in the parent too, and the parent of the tree is the shared temp dir.
 */
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
  const dir = tree('cwd/x');
  const ctx = { cwd: path.join(dir, 'cwd'), home: HOME };
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
  const dir = tree('cwd/a/arch.config.js', 'cwd/b/arch.config.js');
  const ctx = { cwd: path.join(dir, 'cwd'), home: HOME };
  try {
    let s = { screen: 'menu', cursor: 0, project: { dir: path.join(dir, 'cwd/b'), here: false }, values: {}, matches: [], message: '' };
    assert.strictEqual(press(s, ctx, 'p').pick, 1);
    assert.strictEqual(press(s, ctx, 'p', 'escape').project.dir, path.join(dir, 'cwd/b'));
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

const plain = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
const screen = (s, ctx, cols = 100, rows = 30) => plain(M.view(s, ctx, cols, rows)).join('\n');

test('the menu names the project and shows the command under the cursor', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: { dir: HOME + '/code/api', here: false }, values: {}, matches: [], message: '' };
  const text = screen(s, ctx);
  assert.match(text, /~\/code\/api/);
  for (const r of M.ROWS) assert.ok(text.includes(r.label), r.label);
  assert.match(text, /\$ metatron-nest ~\/code\/api/);
  assert.match(screen(press(s, ctx, 'down'), ctx), /\$ metatron-nest serve ~\/code\/api/);
});

test('with no project the menu says so, rather than show a command that would fail', () => {
  const s = { screen: 'menu', cursor: 0, project: null, values: {}, matches: [], message: '' };
  const text = screen(s, { cwd: '/', home: HOME });
  assert.match(text, /no project chosen/);
  assert.match(text, /choose a project first/);
  assert.doesNotMatch(text, /\$ metatron-nest/);
});

test('a form shows its values, the focused hint and the command as it changes', () => {
  const { s, ctx } = inForm('d');
  const text = screen(press(s, ctx, ...typed('main...HEAD')), ctx);
  assert.match(text, /Range\s+main\.\.\.HEAD/);
  assert.match(text, /default branch's merge base/);
  assert.match(text, /\$ metatron-nest diff main\.\.\.HEAD/);
  assert.match(text, /terminal {2}markdown {2}json/, 'a choice shows every option');
  assert.match(screen(press(s, ctx, 'down', 'space'), ctx), /Staged\s+\[x\]/);
  assert.match(screen(press(s, ctx, 'down', 'space'), ctx), /\$ metatron-nest diff --staged/);
});

test('Baseline and Check say when the baseline file will get in the way', () => {
  const dir = tree('api/arch.config.js');
  const ctx = { cwd: path.join(dir, 'api'), home: HOME };
  try {
    const s = M.init(ctx);
    assert.match(screen(press(s, ctx, 'c'), ctx), /no arch\.baseline\.json yet: run Baseline first/);
    assert.doesNotMatch(screen(press(s, ctx, 'l'), ctx), /exists/);
    fs.writeFileSync(path.join(dir, 'api', 'arch.baseline.json'), '{}');
    assert.match(screen(press(s, ctx, 'l'), ctx), /arch\.baseline\.json exists: turn on Update/);
    assert.doesNotMatch(screen(press(s, ctx, 'c'), ctx), /run Baseline first/);
    assert.match(screen({ ...s, cursor: M.ROWS.findIndex((r) => r.id === 'baseline') }, ctx), /exists: turn on Update/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the project list marks the current one and always offers a path', () => {
  const dir = tree('cwd/a/arch.config.js', 'cwd/b/arch.config.js');
  const ctx = { cwd: path.join(dir, 'cwd'), home: path.join(dir, 'cwd') };
  try {
    const s = { screen: 'menu', cursor: 0, project: { dir: path.join(dir, 'cwd/b'), here: false }, values: {}, matches: [], message: '' };
    const text = screen(press(s, ctx, 'p'), ctx);
    assert.match(text, /~\/a\n/);
    assert.match(text, /~\/b {2}current/);
    assert.match(text, /Type a path…/);
    const empty = tree('cwd/x');
    try {
      assert.match(screen(M.init({ cwd: path.join(empty, 'cwd'), home: HOME }), ctx), /No arch\.config\.js near here/);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the path screen shows what was typed, the matches and what went wrong', () => {
  const dir = tree('home/api/x', 'home/app/x', 'cwd/x');
  const ctx = { cwd: path.join(dir, 'cwd'), home: path.join(dir, 'home') };
  try {
    const s = press(M.init(ctx), ctx, 'return', ...typed('~/a'), 'tab');
    assert.match(screen(s, ctx), /~\/ap/);
    assert.match(screen(s, ctx), /api {2}app/);
    assert.match(screen(press(s, ctx, 'return'), ctx), /~\/ap does not exist/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nothing is wider than the terminal, colour codes aside', () => {
  const { s, ctx } = inForm('d');
  const long = press(s, ctx, ...typed('feature/a-very-long-branch-name...feature/another-very-long-branch-name'));
  for (const line of plain(M.view(long, ctx, 40, 24))) assert.ok([...line].length <= 39, line);
  const rendered = M.view(long, ctx, 40, 24).join('\n');
  assert.strictEqual((rendered.match(/\x1b\[0m/g) || []).length, (rendered.match(/\x1b\[(?:1|2|7|36)m/g) || []).length, 'a clipped line still closes its colours');
});

test('a long command wraps instead of losing its end', () => {
  const { s, ctx } = inForm('d');
  const long = press(s, ctx, ...typed('feature/a-very-long-branch-name...feature/another-very-long-branch-name'));
  const text = plain(M.view(long, ctx, 40, 24)).map((l) => l.trim()).join('');
  assert.ok(text.includes('another-very-long-branch-name'));
});

test('a short terminal scrolls the list to keep the cursor on screen', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: { dir: '/p/api', here: true }, values: {}, matches: [], message: '' };
  for (let cursor = 0; cursor < M.ROWS.length; cursor++) {
    const lines = plain(M.view({ ...s, cursor }, ctx, 80, 10));
    assert.ok(lines.length <= 10);
    assert.ok(lines.some((l) => l.includes('▸') && l.includes(M.ROWS[cursor].label)), M.ROWS[cursor].label);
  }
});

test('a terminal that reports no size is treated as 80 by 24', () => {
  const ctx = { cwd: '/', home: HOME };
  const s = { screen: 'menu', cursor: 0, project: { dir: '/p/api', here: true }, values: {}, matches: [], message: '' };
  assert.ok(M.view(s, ctx, 0, 0).length > M.ROWS.length);
  assert.ok(M.view(s, ctx, undefined, undefined).length > M.ROWS.length);
});

/**
 * The real binary on a real pseudo-terminal: raw mode, the alternate screen and
 * Ctrl-C reaching the right process cannot be seen any other way. `script` is
 * util-linux; its BSD namesake on macOS takes different arguments.
 */
const noPty = process.platform !== 'linux' || spawnSync('script', ['--version']).error ? 'needs util-linux script' : false;

function terminal(cwd, args = ['menu']) {
  const command = [process.execPath, BIN, ...args].join(' ');
  const child = spawn('script', ['-qfec', command, '/dev/null'], { cwd, env: { ...process.env, TERM: 'xterm' } });
  let output = '', read = 0;
  child.stdout.on('data', (d) => { output += d; });
  const close = new Promise((resolve) => child.on('close', resolve));
  return {
    send: (text) => child.stdin.write(text),
    /** Waits for a pattern in what has arrived since the last match, so a stale frame cannot satisfy it. */
    until: async (pattern, ms = 20000) => {
      const end = Date.now() + ms;
      for (;;) {
        const m = pattern.exec(output.slice(read));
        if (m) { read += m.index + m[0].length; return m; }
        if (Date.now() > end) throw new Error(`no ${pattern} in: ${JSON.stringify(output.slice(read).slice(-600))}`);
        await new Promise((r) => setTimeout(r, 15));
      }
    },
    /** Rejects rather than waits forever, so a menu that will not quit fails its test and is cleaned up. */
    closed: (ms = 20000) => Promise.race([close, new Promise((_, reject) => {
      setTimeout(() => reject(new Error('still running: ' + JSON.stringify(output.slice(-300)))), ms).unref();
    })]),
    output: () => output,
    kill: () => child.kill('SIGKILL'),
  };
}

const project = () => {
  const dir = tree('api/src/a.ts');
  fs.writeFileSync(path.join(dir, 'api/arch.config.js'), "module.exports = { root: 'src' };\n");
  return dir;
};

test('without a terminal it says so and exits 2, and needs no config', () => {
  const dir = tree('x');
  try {
    const r = spawnSync(process.execPath, [BIN, 'menu'], { cwd: dir, input: '', encoding: 'utf8' });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /needs a terminal/);
    assert.strictEqual(r.stdout, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--help lists the menu', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, /metatron-nest menu/);
});

test('q leaves the alternate screen, shows the cursor again and exits 0', { skip: noPty }, async () => {
  const dir = project();
  const t = terminal(path.join(dir, 'api'));
  try {
    await t.until(/\x1b\[\?1049h/);
    await t.until(/Workbench/);
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
    assert.match(t.output(), /\x1b\[\?25h\x1b\[\?1049l/);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a run shows its command and its result, then any key returns to the menu', { skip: noPty }, async () => {
  const dir = project();
  const t = terminal(path.join(dir, 'api'));
  try {
    await t.until(/Workbench/);
    t.send('s');
    await t.until(/\$ metatron-nest scan/);
    await t.until(/coverage/);
    await t.until(/exit 0/);
    assert.ok(fs.existsSync(path.join(dir, 'api/.metatron/model.json')), 'the real command ran');
    t.send(' ');
    await t.until(/\x1b\[\?1049h/);
    await t.until(/Workbench/);
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Ctrl-C stops the workbench and comes back to the menu, the port remembered', { skip: noPty }, async () => {
  const dir = project();
  const t = terminal(path.join(dir, 'api'));
  try {
    await t.until(/Workbench/);
    t.send('w');
    await t.until(/Port/);
    t.send('\x150');                    // Ctrl-U, then port 0: any free one
    await t.until(/serve --port 0/);
    t.send('\r');
    await t.until(/metatron workbench/);
    await t.until(/http:\/\/127\.0\.0\.1:\d+/);
    t.send('\x03');
    await t.until(/stopped/);
    t.send('w');                        // any key, even one the menu would act on
    await t.until(/\x1b\[\?1049h/);
    await t.until(/Quit/);
    await t.until(/\$ metatron-nest serve --port 0/);
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('after a run, q quits with the output left on the screen', { skip: noPty }, async () => {
  const dir = project();
  const t = terminal(path.join(dir, 'api'));
  try {
    await t.until(/Workbench/);
    t.send('h');
    await t.until(/exit 0/);
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
    const tail = t.output().slice(t.output().lastIndexOf('\x1b[?1049l'));
    assert.match(tail, /scan and build every lens/);
    assert.doesNotMatch(tail, /\x1b\[\?1049h/);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('from a directory with no config it opens on the project list', { skip: noPty }, async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'elsewhere'));
  const t = terminal(path.join(dir, 'elsewhere'));
  try {
    await t.until(/Choose a project/);
    await t.until(/\/api/);
    t.send('\r');
    await t.until(/Workbench/);
    t.send('s');
    await t.until(/\$ metatron-nest scan \S*\/api/);
    await t.until(/exit 0/);
    assert.ok(fs.existsSync(path.join(dir, 'api/.metatron/model.json')), 'the path reached the command');
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('keys pressed during a run do not answer the prompt after it', { skip: noPty }, async () => {
  const dir = project();
  const t = terminal(path.join(dir, 'api'));
  try {
    await t.until(/Workbench/);
    t.send('w');
    await t.until(/Port/);
    t.send('\x150\r');
    await t.until(/http:\/\/127\.0\.0\.1:\d+/);
    t.send('\r\r');                      // waiting in the terminal's buffer
    t.send('\x03');
    await t.until(/stopped/);
    await new Promise((r) => setTimeout(r, 300));
    assert.doesNotMatch(t.output().slice(t.output().lastIndexOf('stopped')), /\x1b\[\?1049h/, 'still at the prompt');
    t.send(' ');
    await t.until(/\x1b\[\?1049h/);
    t.send('q');
    assert.strictEqual(await t.closed(), 0);
  } finally { t.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a long path keeps its end, since that is what tells two projects apart', () => {
  const ctx = { cwd: '/', home: HOME };
  const deep = '/very/long/path/that/goes/on/and/on/and/on/and/on/chronus';
  const s = { screen: 'menu', cursor: 0, project: { dir: deep + '/backend', here: true }, values: {}, matches: [], message: '' };
  assert.match(screen(s, ctx, 40), /…\S*chronus\/backend/);
  const list = { ...s, screen: 'projects', projects: [deep + '/backend', deep + '/frontend'], pick: 0 };
  assert.match(screen(list, ctx, 40), /chronus\/backend {2}current/);
  assert.match(screen(list, ctx, 40), /chronus\/frontend/);
  for (const line of plain(M.view(list, ctx, 40, 24))) assert.ok([...line].length <= 39, line);
});

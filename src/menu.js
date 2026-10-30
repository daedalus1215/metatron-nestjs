'use strict';
/**
 * `metatron-nest menu`: a keyboard menu over the CLI's own commands.
 *
 * It adds no behaviour. Every choice ends as an argv for bin/metatron.js, and
 * the screen shows that command before it runs, so anything done here can be
 * typed or scripted later.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { listTemplates } = require('./build');
const { find, NAMES } = require('./config');
const { FILENAME } = require('./baseline');

const BIN = path.resolve(__dirname, '..', 'bin', 'metatron.js');
const when = (on, ...args) => (on ? args : []);
const LENSES = listTemplates().map((f) => f.replace(/\.html$/, ''));

// The order of a first run: build it, look at it, then hold the line. `project`
// says the command reads a project, so it needs one chosen and is given its path.
const ACTIONS = [
  { id: 'build', key: 'b', label: 'Build', hint: 'scan and render every view', project: true, fields: [],
    argv: () => [] },
  { id: 'serve', key: 'w', label: 'Workbench', hint: 'bricks, wiring and source, live', project: true,
    fields: [
      { id: 'port', type: 'number', label: 'Port', value: '4477', hint: 'where it listens, on 127.0.0.1' },
      { id: 'watch', type: 'toggle', label: 'Watch', value: true, hint: 're-scan when a file is saved' },
    ],
    argv: (v) => ['serve', ...when(v.port && v.port !== '4477', '--port', v.port), ...when(!v.watch, '--no-watch')] },
  { id: 'views', key: 'v', label: 'Views', hint: 're-render from the cached model', project: true,
    fields: [
      { id: 'lens', type: 'choice', label: 'View', options: ['all', ...LENSES], value: 'all', hint: 'which view to render' },
    ],
    argv: (v) => ['views', ...when(v.lens !== 'all', v.lens)] },
  { id: 'scan', key: 's', label: 'Scan', hint: 'model only, no views', project: true, fields: [],
    argv: () => ['scan'] },
  { id: 'check', key: 'c', label: 'Check', hint: 'fail if new violations appeared since the baseline', project: true,
    fields: [
      { id: 'rule', type: 'text', label: 'Rules', value: '', hint: 'gate on these rule ids only, separated by spaces; blank gates every rule' },
      { id: 'allowNew', type: 'number', label: 'Allow new', value: '0', hint: 'tolerate up to this many new violations' },
      { id: 'fixed', type: 'toggle', label: 'List fixed', value: true, hint: 'list violations fixed since the baseline' },
      { id: 'json', type: 'toggle', label: 'JSON', value: false, hint: 'machine-readable result' },
    ],
    argv: (v) => ['check',
      ...v.rule.split(/[\s,]+/).filter(Boolean).flatMap((r) => ['--rule', r]),
      ...when(v.allowNew && v.allowNew !== '0', '--allow-new', v.allowNew),
      ...when(!v.fixed, '--no-fixed'),
      ...when(v.json, '--json')] },
  { id: 'baseline', key: 'l', label: 'Baseline', hint: "record today's violations as accepted", project: true,
    fields: [
      { id: 'update', type: 'toggle', label: 'Update', value: false, hint: 'rewrite an existing baseline, keeping hand-written notes' },
    ],
    argv: (v) => ['baseline', ...when(v.update, '--update')] },
  { id: 'diff', key: 'd', label: 'Diff', hint: 'blast radius of a change set', project: true,
    fields: [
      { id: 'range', type: 'text', label: 'Range', value: '', hint: "<base>...<head>; blank is the default branch's merge base ... HEAD" },
      { id: 'staged', type: 'toggle', label: 'Staged', value: false, hint: 'what is about to be committed, instead of a range' },
      { id: 'format', type: 'choice', label: 'Format', options: ['terminal', 'markdown', 'json'], value: 'terminal', hint: 'markdown pastes into a PR description' },
    ],
    argv: (v) => ['diff',
      ...when(v.range && !v.staged, v.range),
      ...when(v.staged, '--staged'),
      ...when(v.format !== 'terminal', '--format', v.format)] },
  { id: 'skill', key: 'i', label: 'Skill', hint: 'install the agent skill', project: false,
    fields: [
      { id: 'dest', type: 'path', label: 'Into', value: '', hint: 'installs into <dir>/metatron-nest/; blank is ~/.agents/skills' },
      { id: 'where', type: 'toggle', label: 'Only print', value: false, hint: 'say where it would go, and install nothing' },
    ],
    argv: (v) => ['skill', ...when(v.dest, '--dest', v.dest), ...when(v.where, '--where')] },
  { id: 'help', key: 'h', label: 'Help', hint: 'every command and flag', project: false, fields: [],
    argv: () => ['--help'] },
];

const tilde = (p, home) => (p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);
const defaultsOf = (action) => Object.fromEntries(action.fields.map((f) => [f.id, f.value]));
const valuesOf = (s, action) => ({ ...defaultsOf(action), ...s.values[action.id] });

/** The argv an action runs: its own, then the project unless the CLI would find that itself. */
function argvFor(action, values, project) {
  const pass = action.project && project && !project.here;
  return [...action.argv(values), ...(pass ? [project.dir] : [])];
}

/** The same argv as the line you would type, for the screen. */
function commandLine(argv, home) {
  const quote = (a) => (/^[\w@%+=:,./^~-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  return ['metatron-nest', ...argv.map((a) => quote(tilde(a, home)))].join(' ');
}

// Copies, output and other people's code. A fixture's config is not a project.
const NOT_PROJECTS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'fixtures', '__fixtures__']);

/**
 * The directories holding a config, down from each root. The walk is bounded in
 * depth and size, so opening the list stays instant when started from a home
 * directory.
 */
function discover(roots, depth = 3, limit = 5000) {
  const found = new Set();
  let visited = 0;
  const walk = (dir, left) => {
    if (++visited > limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && NAMES.includes(e.name))) found.add(dir);
    if (left === 0) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !NOT_PROJECTS.has(e.name)) walk(path.join(dir, e.name), left - 1);
    }
  };
  for (const root of roots) walk(root, depth);
  return [...found].sort();
}

const expand = (text, ctx) => path.resolve(ctx.cwd, text.replace(/^~(?=\/|$)/, ctx.home));

/** Tab on a path: as far as the matching directories agree, and which they are. */
function completeDir(text, ctx) {
  if (text === '~') return { text: '~/', matches: [] };
  // Split what was typed, not the resolved path: `..` resolves to a name nobody typed.
  const cut = text.lastIndexOf('/') + 1;
  const typed = text.slice(0, cut), stem = text.slice(cut);
  let matches;
  try {
    matches = fs.readdirSync(expand(typed, ctx), { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && e.name.startsWith(stem))
      .map((e) => e.name).sort();
  } catch { return { text, matches: [] }; }
  if (!matches.length) return { text, matches };
  let shared = matches[0];
  for (const m of matches) while (!m.startsWith(shared)) shared = shared.slice(0, -1);
  return { text: typed + shared + (matches.length === 1 ? '/' : ''), matches: matches.length === 1 ? [] : matches };
}

const ROWS = [
  ...ACTIONS,
  { id: 'project', key: 'p', label: 'Project', hint: 'choose another project' },
  { id: 'quit', key: 'q', label: 'Quit', hint: '' },
];

const isEnter = (key) => key.name === 'return' || key.name === 'enter';
const step = (at, by, n) => (at + by + n) % n;
const moved = (key) => (key.name === 'up' || key.name === 'k' ? -1 : key.name === 'down' || key.name === 'j' ? 1 : 0);

/** What a key does to a line of text. */
function edit(text, key, digitsOnly) {
  if (key.name === 'backspace') return [...text].slice(0, -1).join('');
  if (key.ctrl && key.name === 'u') return '';
  const printable = key.str && !key.ctrl && !key.meta && [...key.str].length === 1 && key.str >= ' ' && key.str !== '\x7f';
  return printable && (!digitsOnly || /\d/.test(key.str)) ? text + key.str : text;
}

function init(ctx) {
  const file = find(ctx.cwd);
  const state = { screen: 'menu', cursor: 0, project: file ? { dir: path.dirname(file), here: true } : null, values: {}, matches: [], message: '' };
  return file ? state : openProjects(state, ctx);
}

function openProjects(s, ctx, message = '') {
  const near = discover([ctx.cwd, path.dirname(ctx.cwd)]);
  const projects = s.project && !near.includes(s.project.dir) ? [s.project.dir, ...near] : near;
  return { ...s, screen: 'projects', projects, pick: s.project ? projects.indexOf(s.project.dir) : 0, message };
}

// The path is left off the command when the CLI would find the same config from here.
function useProject(s, dir, ctx) {
  const file = find(dir);
  return { ...s, screen: 'menu', message: '', project: { dir: path.dirname(file), here: find(ctx.cwd) === file } };
}

function choose(s, row, ctx) {
  if (row.id === 'quit') return { ...s, quit: true };
  if (row.id === 'project') return openProjects(s, ctx);
  if (row.project && !s.project) return openProjects(s, ctx, `${row.label} reads a project. Choose one first.`);
  if (!row.fields.length) return { ...s, run: argvFor(row, {}, s.project) };
  return { ...s, screen: 'form', action: row.id, field: 0 };
}

function onMenu(s, key, ctx) {
  if (moved(key)) return { ...s, cursor: step(s.cursor, moved(key), ROWS.length) };
  if (isEnter(key)) return choose(s, ROWS[s.cursor], ctx);
  const at = key.ctrl || key.meta ? -1 : ROWS.findIndex((r) => r.key === key.name);
  return at < 0 ? s : choose({ ...s, cursor: at }, ROWS[at], ctx);
}

// The list's last row is not a project: it asks for a path.
function onProjects(s, key, ctx) {
  if (moved(key)) return { ...s, pick: step(s.pick, moved(key), s.projects.length + 1) };
  if (key.name === 'escape' || key.name === 'q') return { ...s, screen: 'menu', message: '' };
  if (!isEnter(key)) return s;
  if (s.pick < s.projects.length) return useProject(s, s.projects[s.pick], ctx);
  return { ...s, screen: 'path', text: '', matches: [], message: '' };
}

function onPath(s, key, ctx) {
  if (key.name === 'escape') return { ...s, screen: 'projects', matches: [], message: '' };
  if (key.name === 'tab') return { ...s, ...completeDir(s.text, ctx), message: '' };
  if (!isEnter(key)) return { ...s, text: edit(s.text, key), matches: [], message: '' };
  const full = expand(s.text, ctx);
  if (!fs.existsSync(full)) return { ...s, message: `${s.text} does not exist` };
  if (!find(full)) return { ...s, message: `no arch.config.js at or above ${s.text || full}` };
  return useProject(s, full, ctx);
}

// Arrows and Tab only move here: a letter may be text being typed.
function onForm(s, key, ctx) {
  const action = ACTIONS.find((a) => a.id === s.action);
  const field = action.fields[s.field];
  const values = valuesOf(s, action);
  const n = action.fields.length;
  const set = (value, matches = []) => ({ ...s, matches, values: { ...s.values, [action.id]: { ...values, [field.id]: value } } });
  const go = (by) => ({ ...s, matches: [], field: step(s.field, by, n) });

  if (key.name === 'escape') return { ...s, screen: 'menu', matches: [] };
  if (isEnter(key)) return { ...s, run: argvFor(action, values, s.project) };
  if (key.name === 'up' || (key.name === 'tab' && key.shift)) return go(-1);
  if (key.name === 'tab' && field.type === 'path') {
    const done = completeDir(values[field.id], ctx);
    return set(done.text, done.matches);
  }
  if (key.name === 'down' || key.name === 'tab') return go(1);
  if (field.type === 'toggle') return ['space', 'left', 'right'].includes(key.name) ? set(!values[field.id]) : s;
  if (field.type === 'choice') {
    const by = key.name === 'left' ? -1 : key.name === 'right' || key.name === 'space' ? 1 : 0;
    return by ? set(field.options[step(field.options.indexOf(values[field.id]), by, field.options.length)]) : s;
  }
  return set(edit(values[field.id], key, field.type === 'number'));
}

const SCREENS = { menu: onMenu, form: onForm, projects: onProjects, path: onPath };

/** A key, to the next state. `state.run` is an argv to run; `state.quit` ends the menu. */
function update(s, key, ctx) {
  if (key.ctrl && key.name === 'c') return { ...s, quit: true };
  return SCREENS[s.screen](s, key, ctx);
}

const sgr = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
const bold = sgr(1), dim = sgr(2), accent = sgr(36), caret = sgr(7)(' ');
const pointer = (on) => (on ? accent('▸') + ' ' : '  ');

/** Cuts a line to a width, counting what shows and keeping every colour code. */
function clip(line, cols) {
  let left = cols;
  return line.split(/(\x1b\[[0-9;]*m)/).map((part) => {
    if (part.startsWith('\x1b')) return part;
    const kept = [...part].slice(0, left);
    left -= kept.length;
    return kept.join('');
  }).join('');
}

const wrap = (text, cols) => text.match(new RegExp(`.{1,${cols}}`, 'g')) || [''];

// A path's end is what tells two projects apart, so it is the start that goes.
const fit = (text, cols) => (text.length > cols ? '…' + text.slice(1 - cols) : text);

/** What the project's state means for this command, when it would otherwise surprise you. */
function noteFor(action, project) {
  if (!project || !['baseline', 'check'].includes(action.id)) return '';
  const has = fs.existsSync(path.join(project.dir, FILENAME));
  if (action.id === 'baseline' && has) return `${FILENAME} exists: turn on Update to rewrite it`;
  if (action.id === 'check' && !has) return `no ${FILENAME} yet: run Baseline first`;
  return '';
}

function showValue(field, value, focused) {
  if (field.type === 'toggle') return value ? '[x]' : '[ ]';
  if (field.type === 'choice') return field.options.map((o) => (o === value ? accent(o) : dim(o))).join('  ');
  return focused ? value + caret : value || dim('-');
}

const FORM_KEYS = {
  text: 'type',
  number: 'type',
  path: 'type · tab completes',
  toggle: 'space toggles',
  choice: '←→ choose',
};

function preview(s, row, ctx, cols) {
  if (!row.argv) return [''];
  if (row.project && !s.project) return [dim('choose a project first')];
  return wrap('$ ' + commandLine(argvFor(row, valuesOf(s, row), s.project), ctx.home), cols).map(accent);
}

function viewMenu(s, ctx, cols) {
  const wide = Math.max(...ROWS.map((r) => r.label.length));
  const row = ROWS[s.cursor];
  const note = noteFor(row, s.project);
  return {
    head: [bold('metatron'), dim(s.project ? fit(tilde(s.project.dir, ctx.home), cols) : 'no project chosen'), ''],
    list: ROWS.map((r, i) => {
      const label = r.label.padEnd(wide);
      return `${pointer(i === s.cursor)}${accent(r.key)}  ${i === s.cursor ? bold(label) : label}  ${dim(r.hint)}`;
    }),
    at: s.cursor,
    tail: ['', ...preview(s, row, ctx, cols), note ? dim(note) : '', dim('↑↓ move · enter choose · letters jump · q quit')],
  };
}

function viewForm(s, ctx, cols) {
  const action = ACTIONS.find((a) => a.id === s.action);
  const field = action.fields[s.field];
  const values = valuesOf(s, action);
  const wide = Math.max(...action.fields.map((f) => f.label.length));
  const note = noteFor(action, s.project);
  return {
    head: [
      bold(action.label) + dim(' · ' + action.hint),
      action.project ? dim(fit(tilde(s.project.dir, ctx.home), cols)) : '',
      ...(note ? [note] : []),
      '',
    ],
    list: action.fields.map((f, i) => {
      const label = f.label.padEnd(wide);
      return `${pointer(i === s.field)}${i === s.field ? bold(label) : label}  ${showValue(f, values[f.id], i === s.field)}`;
    }),
    at: s.field,
    tail: [
      '',
      dim(field.hint),
      ...(s.matches.length ? [dim(s.matches.join('  '))] : []),
      ...preview(s, action, ctx, cols),
      '',
      dim(`${FORM_KEYS[field.type]} · ↑↓ field · enter run · esc back`),
    ],
  };
}

function viewProjects(s, ctx, cols) {
  const names = [...s.projects.map((p) => fit(tilde(p, ctx.home), cols - 11)), 'Type a path…'];
  const none = s.projects.length ? [] : [dim('No arch.config.js near here.')];
  return {
    head: [bold('Choose a project'), ...(s.message ? [s.message] : []), ...none, ''],
    list: names.map((name, i) => {
      const current = s.project && s.projects[i] === s.project.dir ? dim('  current') : '';
      return pointer(i === s.pick) + (i === s.pick ? bold(name) : name) + current;
    }),
    at: s.pick,
    tail: ['', dim('↑↓ move · enter choose · esc back')],
  };
}

function viewPath(s) {
  return {
    head: [bold('Type a path'), dim('a project, or anywhere inside one'), ''],
    list: [pointer(true) + s.text + caret],
    at: 0,
    tail: [
      '',
      ...(s.matches.length ? [dim(s.matches.join('  '))] : []),
      ...(s.message ? [s.message] : []),
      dim('tab completes · enter choose · esc back'),
    ],
  };
}

const VIEWS = { menu: viewMenu, form: viewForm, projects: viewProjects, path: viewPath };

/** A state, to the lines of the screen: a list scrolled to its cursor, clipped to fit. */
function view(s, ctx, columns, lines) {
  const cols = Math.max((columns || 80) - 2, 1), rows = lines || 24;
  const { head, list, at, tail } = VIEWS[s.screen](s, ctx, cols);
  const room = Math.max(rows - head.length - tail.length, 1);
  const first = Math.min(Math.max(at - Math.floor(room / 2), 0), Math.max(list.length - room, 0));
  return [...head, ...list.slice(first, first + room), ...tail].slice(0, rows).map((l) => ' ' + clip(l, cols));
}

const OPEN = '\x1b[?1049h\x1b[?25l', CLOSE = '\x1b[?25h\x1b[?1049l';

// Painted over the last frame rather than cleared, so nothing flickers.
const draw = (lines) => '\x1b[H' + lines.join('\x1b[K\r\n') + '\x1b[K\x1b[J';

/** The only part that touches the terminal: keys in, frames out, commands run. */
function start() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('metatron-nest menu needs a terminal. To script a command, run it directly: see --help.');
    process.exit(2);
  }
  const ctx = { cwd: process.cwd(), home: os.homedir() };
  let state = init(ctx);
  let showing = false;

  const paint = () => { if (showing) stdout.write(draw(view(state, ctx, stdout.columns, stdout.rows))); };

  const show = () => {
    showing = true;
    stdout.write(OPEN);
    stdin.setRawMode(true);
    stdin.on('keypress', onKey);
    stdin.resume();
    paint();
  };

  const hide = () => {
    showing = false;
    stdin.removeListener('keypress', onKey);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write(CLOSE);
  };

  const onKey = (str, key) => {
    state = update(state, { ...key, str }, ctx);
    if (state.quit) { hide(); process.exit(0); }
    if (!state.run) { paint(); return; }
    const argv = state.run;
    state = { ...state, run: null, screen: 'menu' };
    hide();
    launch(argv);
  };

  // The run happens on the normal screen, so its output stays in the scrollback.
  const launch = (argv) => {
    stdout.write(`${accent('$ ' + commandLine(argv, ctx.home))}\n`);
    // The terminal sends Ctrl-C to the whole foreground group. It is meant for
    // the command, and the menu has to outlive it: that is how `serve` is stopped.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const child = spawn(process.execPath, [BIN, ...argv], { stdio: 'inherit' });
    child.on('error', (e) => console.error(e.message));
    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', ignore);
      pause(signal ? 'stopped' : `exit ${code}`);
    });
  };

  // Keys pressed while the command ran are still in the terminal's buffer, and
  // they were no answer to this prompt. The stream drops them while nothing is
  // listening, so the prompt waits a moment before it listens.
  const pause = (outcome) => {
    stdin.setRawMode(true);
    stdin.resume();
    setTimeout(() => {
      stdout.write(`\n${bold(outcome)} ${dim('· any key for the menu · q to quit')}\n`);
      stdin.once('keypress', (str, key) => {
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) process.exit(0);
        show();
      });
    }, 50);
  };

  readline.emitKeypressEvents(stdin, { escapeCodeTimeout: 50 });
  stdout.on('resize', paint);
  process.on('exit', () => { if (showing) stdout.write(CLOSE); });
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(1));
  show();
}

module.exports = { ACTIONS, ROWS, defaultsOf, argvFor, commandLine, discover, expand, completeDir, init, update, view, start };

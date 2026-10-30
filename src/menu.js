'use strict';
/**
 * `metatron-nest menu`: a keyboard menu over the CLI's own commands.
 *
 * It adds no behaviour. Every choice ends as an argv for bin/metatron.js, and
 * the screen shows that command before it runs, so anything done here can be
 * typed or scripted later.
 */
const fs = require('fs');
const path = require('path');
const { listTemplates } = require('./build');
const { NAMES } = require('./config');

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

const defaultsOf = (action) => Object.fromEntries(action.fields.map((f) => [f.id, f.value]));

/** The argv an action runs: its own, then the project unless the CLI would find that itself. */
function argvFor(action, values, project) {
  const pass = action.project && project && !project.here;
  return [...action.argv(values), ...(pass ? [project.dir] : [])];
}

/** The same argv as the line you would type, for the screen. */
function commandLine(argv, home) {
  const tilde = (a) => (a === home || a.startsWith(home + path.sep) ? '~' + a.slice(home.length) : a);
  const quote = (a) => (/^[\w@%+=:,./^~-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  return ['metatron-nest', ...argv.map((a) => quote(tilde(a)))].join(' ');
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
  const full = expand(text, ctx);
  const [dir, stem] = !text || text.endsWith('/') ? [full, ''] : [path.dirname(full), path.basename(full)];
  let matches;
  try {
    matches = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && e.name.startsWith(stem))
      .map((e) => e.name).sort();
  } catch { return { text, matches: [] }; }
  if (!matches.length) return { text, matches };
  let shared = matches[0];
  for (const m of matches) while (!m.startsWith(shared)) shared = shared.slice(0, -1);
  const typed = text.slice(0, text.length - stem.length);
  return { text: typed + shared + (matches.length === 1 ? '/' : ''), matches: matches.length === 1 ? [] : matches };
}

module.exports = { ACTIONS, defaultsOf, argvFor, commandLine, discover, expand, completeDir };

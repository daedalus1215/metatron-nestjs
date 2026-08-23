'use strict';
const fs = require('fs');
const path = require('path');

const PROFILES = { nestjs: require('./defaults/nestjs') };

/** Finds arch.config.js by walking up from `from`. */
function find(from) {
  let dir = path.resolve(from);
  for (;;) {
    const p = path.join(dir, 'arch.config.js');
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * A sensible project name from the config's location. `backend/` and friends are
 * containers, not project names, so we climb past them.
 */
const GENERIC = new Set(['backend', 'src', 'api', 'server', 'app', 'apps', 'packages', 'services']);
function inferName(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 3; i++) {
    const base = path.basename(d);
    if (!GENERIC.has(base.toLowerCase())) return base;
    d = path.dirname(d);
  }
  return path.basename(path.resolve(dir));
}

/** Loose match, so `chronus` is happy inside `chronus-react-nestjs`. */
function looselyMatches(a, b) {
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const A = norm(a), B = norm(b);
  return !A || !B || A.includes(B) || B.includes(A);
}

function load(from = process.cwd()) {
  const file = find(from);
  if (!file) {
    throw new Error(
      'No arch.config.js found (searched upward from ' + path.resolve(from) + ').\n' +
      'Create one:\n\n' +
      "  module.exports = { extends: 'nestjs', name: 'my-api', root: 'src' };\n"
    );
  }
  const user = require(file);
  const base = PROFILES[user.extends || 'nestjs'];
  if (!base) throw new Error(`unknown profile "${user.extends}" — available: ${Object.keys(PROFILES).join(', ')}`);

  // shallow merge, but patterns/tiers replace wholesale when given, and
  // `addPatterns` prepends so a project can refine without restating the world
  const cfg = Object.assign({}, base, user);
  if (user.addPatterns) cfg.patterns = user.addPatterns.concat(base.patterns);
  cfg.__dir = path.dirname(file);
  cfg.__file = file;

  const inferred = inferName(cfg.__dir);
  if (!cfg.name) {
    cfg.name = inferred;
  } else if (!looselyMatches(cfg.name, inferred)) {
    // Almost always a config copied from another project with the name left behind
    cfg.__nameWarning =
      `config name is "${cfg.name}" but it sits in "${inferred}" — copied from another project?\n` +
      `  ${cfg.__file}`;
  }
  return cfg;
}

module.exports = { load, find, PROFILES };

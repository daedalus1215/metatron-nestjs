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
  return cfg;
}

module.exports = { load, find, PROFILES };

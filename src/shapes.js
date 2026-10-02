'use strict';
/**
 * Shapes (spec 15): what a TypeScript type says a value looks like, one level
 * deep. A shape is one of
 *
 *   { fields: { name: { optional, type } }, open }   an object (open: it may
 *                                                     carry keys not listed)
 *   { array: shape | null }                          an array of a shape
 *   { none: true }                                   no value (void)
 *
 * or null: unread. Field types are kept for display only; what is compared
 * is names, optionality and array-ness. Anything this cannot read is null,
 * never a guess.
 */

/** Split at top-level separators, outside every bracket and string. */
function splitTop(s, seps) {
  const out = [];
  let d = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{<'.includes(ch)) d++;
    else if (')]}>'.includes(ch) && !(ch === '>' && s[i - 1] === '=')) d--;
    if (d === 0 && seps.includes(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The fields of an object type's body: `a: T; b?: U` (methods and index signatures noted). */
function membersOf(body) {
  const fields = {};
  let open = false;
  for (const m of splitTop(body, ';,\n')) {
    if (/^\[/.test(m)) { open = true; continue; }                  // [key: string]: T
    const f = m.match(/^(?:readonly\s+)?(['"]?)([A-Za-z_$][\w$-]*)\1(\?)?\s*:\s*([\s\S]+)$/);
    if (f) fields[f[2]] = { optional: !!f[3], type: f[4].trim() };
  }
  return { fields, open };
}

/** Wrap-and-unwrap: `Wrapper<inner>` → inner, when the whole expression is that. */
function genericArg(t, name) {
  const m = t.match(new RegExp('^' + name + '\\s*<([\\s\\S]*)>$'));
  return m ? m[1].trim() : null;
}

/**
 * The shape of a type expression. `lookup(name)` resolves a named type to a
 * shape (or null); `depth` stops runaway aliases.
 */
function shapeOf(expr, lookup = () => null, depth = 0) {
  if (!expr || depth > 8) return null;
  let t = String(expr).trim().replace(/;$/, '').trim();
  while (t.startsWith('(') && t.endsWith(')') && splitTop(t.slice(1, -1), '|&').length === 1 && t.slice(1, -1).trim()) t = t.slice(1, -1).trim();

  // unions: T | null | undefined is T; anything else is unread
  const alts = splitTop(t, '|');
  if (alts.length > 1) {
    const real = alts.filter((a) => !/^(null|undefined)$/.test(a));
    return real.length === 1 ? shapeOf(real[0], lookup, depth + 1) : null;
  }
  // intersections: every part's fields
  const parts = splitTop(t, '&');
  if (parts.length > 1) {
    const shapes = parts.map((p) => shapeOf(p, lookup, depth + 1));
    if (shapes.some((s) => !s || !s.fields)) return null;
    return { fields: Object.assign({}, ...shapes.map((s) => s.fields)), open: shapes.some((s) => s.open) };
  }
  if (/^(void|undefined|null|never)$/.test(t)) return { none: true };
  const inner = genericArg(t, 'Promise');
  if (inner !== null) return shapeOf(inner, lookup, depth + 1);
  if (/\[\]$/.test(t)) return { array: shapeOf(t.slice(0, -2), lookup, depth + 1) };
  const arr = genericArg(t, 'Array') || genericArg(t, 'ReadonlyArray');
  if (arr !== null) return { array: shapeOf(arr, lookup, depth + 1) };
  const part = genericArg(t, 'Partial');
  if (part !== null) {
    const s = shapeOf(part, lookup, depth + 1);
    if (!s || !s.fields) return null;
    const fields = {};
    for (const [k, v] of Object.entries(s.fields)) fields[k] = Object.assign({}, v, { optional: true });
    return { fields, open: s.open };
  }
  if (t.startsWith('{') && t.endsWith('}')) return membersOf(t.slice(1, -1));
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return lookup(t, depth + 1);
  return null;                                         // a generic of our own, a conditional, a package type
}

/** The index of `{` matching the `{` at `open`, or -1. */
function closeBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}

/**
 * A class body's fields: top-level statements only (a method's body is not
 * read). `@IsOptional()` or `@ValidateIf(…)` above a field makes it optional,
 * as class-validator does.
 */
function classFields(body) {
  const stmts = [];
  let d = 0, cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    if (d === 0 && (ch === ';' || ch === '\n')) { if (cur.trim()) stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  const fields = {};
  let optional = false;
  for (let st of stmts) {
    while (st.startsWith('@')) {                          // decorators, possibly on the field's own line
      const m = st.match(/^@([\w$.]+)\s*(\([^]*?\))?\s*/);
      if (!m) break;
      if (/^(IsOptional|ValidateIf)$/.test(m[1])) optional = true;
      st = st.slice(m[0].length);
    }
    if (!st) continue;
    const f = st.match(/^(?:(?:public|private|protected|readonly|declare|static)\s+)*([A-Za-z_$][\w$]*)(\?|!)?\s*:\s*([^=]+?)(\s*=[\s\S]*)?$/);
    if (f && !/^static\s/.test(st)) fields[f[1]] = { optional: f[2] === '?' || optional, type: f[3].trim() };
    optional = false;
  }
  return fields;
}

/**
 * Every named type in a side's files: `type X = …`, `interface X {…}` and
 * `class X {…}`. A generic declaration (`type X<T> = …`) is not indexed: its
 * shape depends on an argument.
 */
function typeIndex(text) {
  const index = new Map();
  const add = (name, def) => (index.get(name) || index.set(name, []).get(name)).push(def);
  for (const [file, src] of Object.entries(text)) {
    let m;
    const TYPE = /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(<)?[^=\n]*=\s*/g;
    while ((m = TYPE.exec(src))) {
      if (m[2]) continue;
      const at = m.index + m[0].length;
      if (src[at] === '{') { const c = closeBrace(src, at); if (c > 0) add(m[1], { file, kind: 'type', expr: src.slice(at, c + 1) }); continue; }
      let d = 0, j = at;
      for (; j < src.length; j++) {
        const ch = src[j];
        if ('([{<'.includes(ch)) d++;
        else if (')]}>'.includes(ch)) d--;
        else if (d === 0 && (ch === ';' || (ch === '\n' && !/[|&,]\s*$/.test(src.slice(at, j)) && !/^\s*[|&]/.test(src.slice(j + 1))))) break;
      }
      add(m[1], { file, kind: 'type', expr: src.slice(at, j) });
    }
    const IFACE = /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\s*(<)?([^{]*)\{/g;
    while ((m = IFACE.exec(src))) {
      if (m[2]) continue;
      const open = m.index + m[0].length - 1, c = closeBrace(src, open);
      const ext = (m[3].match(/extends\s+([\s\S]+)/) || [])[1];
      if (c > 0) add(m[1], { file, kind: 'interface', body: src.slice(open + 1, c), extends: ext ? splitTop(ext, ',') : [] });
    }
    const CLASS = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s*(<)?([^{]*)\{/g;
    while ((m = CLASS.exec(src))) {
      if (m[2]) continue;
      const open = m.index + m[0].length - 1, c = closeBrace(src, open);
      const ext = (m[3].match(/extends\s+([A-Za-z_$][\w$]*)/) || [])[1];
      if (c > 0) add(m[1], { file, kind: 'class', body: src.slice(open + 1, c), extends: ext ? [ext] : [] });
    }
  }
  return index;
}

/**
 * A lookup over an index, from `file`. `where(name, file)` says where that
 * file gets a name:
 *
 *   { file, name }      a file of the tree, and the name declared there (an
 *                       import may rename it)
 *   { external: true }  outside the tree, a package's type: unread
 *   null                nowhere in particular: by name across the tree
 *
 * A name defined once is read; one defined twice is unread unless `where`
 * names the file. A named type's own references are looked up from the file
 * that declares it.
 */
function lookupIn(index, where = () => null, file = null) {
  const from = (at) => (name, depth = 0) => {
    if (depth > 8) return null;
    const w = where(name, at);
    if (w && w.external) return null;
    const defs = index.get((w && w.name) || name);
    if (!defs) return null;
    const def = (w && w.file && defs.find((d) => d.file === w.file)) || (defs.length === 1 ? defs[0] : null);
    if (!def) return null;
    const look = from(def.file);
    if (def.kind === 'type') return shapeOf(def.expr, look, depth + 1);
    const own = def.kind === 'class' ? { fields: classFields(def.body), open: false } : membersOf(def.body);
    for (const base of def.extends) {
      const b = shapeOf(base, look, depth + 1);
      if (!b || !b.fields) return null;                    // a base we cannot read: the whole shape is unread
      own.fields = Object.assign({}, b.fields, own.fields);
      own.open = own.open || b.open;
    }
    return own;
  };
  return from(file);
}

module.exports = { shapeOf, membersOf, splitTop, classFields, typeIndex, lookupIn };

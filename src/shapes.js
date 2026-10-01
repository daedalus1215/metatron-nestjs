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

module.exports = { shapeOf, membersOf, splitTop };

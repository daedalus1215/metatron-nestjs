'use strict';
/**
 * The declarations inside one TypeScript file: its classes (with their
 * members), its top-level functions, and its interfaces. Spec 09.
 *
 * This is a walker, not a regex. The scanner's older readers assume one class
 * per file and find a class's constructor by the first `constructor(` in the
 * file, which lends the second class's sockets to the first. Here every class
 * is brace-matched and read inside its own body only.
 *
 * Braces inside strings, template literals, comments and regex literals are
 * skipped, so a `'{'` in a method body cannot end a class early. Anything the
 * walker does not recognise is stepped over, never guessed at: the result is
 * what the file plainly declares, and nothing else.
 */

const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'readonly',
  'async', 'override', 'abstract', 'declare', 'accessor']);
const ID = /[A-Za-z_$#][\w$]*/y;

function parse(src) {
  const n = src.length;

  // 1-based line of an offset, by binary search over line starts.
  const starts = [0];
  for (let i = 0; i < n; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineAt = (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  /** Past a comment, string, template or regex literal starting at i, or i if none. */
  function skipLiteral(i) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); return e < 0 ? n : e; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? n : e + 2; }
    if (c === '\'' || c === '"') {
      for (let j = i + 1; j < n; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === c || src[j] === '\n') return j + 1;
      }
      return n;
    }
    if (c === '`') {
      for (let j = i + 1; j < n; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === '`') return j + 1;
        else if (src[j] === '$' && src[j + 1] === '{') j = close(j + 1);
      }
      return n;
    }
    if (c === '/' && regexCanStart(i)) {
      let inClass = false;
      for (let j = i + 1; j < n; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n') return i;       // not a regex after all
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          let k = j + 1;
          while (k < n && /[a-z]/.test(src[k])) k++;
          return k;
        }
      }
    }
    return i;
  }
  function regexCanStart(i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(src[j])) return true;
    const w = src.slice(Math.max(0, j - 6), j + 1).match(/(?:return|typeof|case|in|of)$/);
    return !!w;
  }
  /** The offset of the bracket closing the one at `open`, or n. */
  function close(open) {
    let d = 0;
    for (let i = open; i < n; i++) {
      const j = skipLiteral(i);
      if (j !== i) { i = j - 1; continue; }
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) return i; }
    }
    return n;
  }
  /** Past whitespace and comments. */
  function ws(i) {
    while (i < n) {
      if (/\s/.test(src[i])) { i++; continue; }
      if (src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipLiteral(i); continue; }
      break;
    }
    return i;
  }
  function ident(i) {
    ID.lastIndex = i;
    const m = ID.exec(src);
    return m ? m[0] : null;
  }
  /** Past a decorator at `i` (which is '@'): name, then optional (...). */
  function decorator(i) {
    let j = i + 1;
    while (j < n && /[\w$.]/.test(src[j])) j++;
    const name = src.slice(i + 1, j);
    const k = ws(j);
    if (src[k] === '(') return { name, end: close(k) + 1 };
    return { name, end: j };
  }
  /** Past a type annotation or initialiser: to the first `stop` char at depth 0. */
  function until(i, stops) {
    let ang = 0;
    while (i < n) {
      const j = skipLiteral(i);
      if (j !== i) { i = j; continue; }
      const c = src[i];
      // `;` ends a statement even inside an unclosed `<`: a comparison can
      // look like a generic, and must not swallow the rest of the file.
      if (stops.includes(c) && (ang === 0 || c === ';')) return i;
      if (c === '<' && /[\w$.\]]/.test(src[i - 1] || '')) ang++;
      else if (c === '>' && src[i - 1] !== '=' && ang > 0) ang--;
      else if (c === '(' || c === '[' || c === '{') { i = close(i) + 1; continue; }
      else if (c === ')' || c === ']' || c === '}') return i;   // the enclosing block ended
      i++;
    }
    return n;
  }
  /** After a parameter list's `)`: the `{` of a body, or -1 if it ends in `;` first. */
  function bodyAfter(i) {
    let ang = 0;
    while (i < n) {
      const j = skipLiteral(i);
      if (j !== i) { i = j; continue; }
      const c = src[i];
      if (c === '<') ang++;
      else if (c === '>' && src[i - 1] !== '=' && ang > 0) ang--;
      else if (c === '{') {
        if (ang === 0) return i;
        i = close(i);              // an object type inside a return type's generics
      } else if (c === '(' || c === '[') i = close(i);
      else if (c === ';' || c === '}') return -1;
      i++;
    }
    return -1;
  }
  const flat = (a, b) => src.slice(a, b).replace(/\s+/g, ' ').trim();

  /** An arrow function starting at `i` (after `=`): `(…) =>` or `x =>`, optional async. */
  function arrowAt(i) {
    let j = ws(i), async = false;
    if (ident(j) === 'async') { async = true; j = ws(j + 5); }
    if (src[j] === '<') j = ws(until(j + 1, '>') + 1);    // generic arrow
    let pOpen = -1, pClose = -1;
    if (src[j] === '(') { pOpen = j; pClose = close(j); j = pClose + 1; }
    else {
      const id = ident(j);
      if (!id) return null;
      pOpen = j; pClose = j + id.length; j = pClose;
    }
    j = ws(j);
    if (src[j] === ':') j = until(j + 1, '=');            // return type, up to `=>`
    j = ws(j);
    if (src[j] !== '=' || src[j + 1] !== '>') return null;
    j = ws(j + 2);
    if (src[j] === '{') return { async, pOpen, pClose, bodyOpen: j, bodyClose: close(j), end: close(j) + 1 };
    const e = until(j, ';,');                             // expression body
    return { async, pOpen, pClose, bodyOpen: j, bodyClose: e, end: e };
  }

  function member(start, i, decos, mods, bodyEnd) {
    const out = { decorators: decos, static: mods.has('static'), async: mods.has('async'),
      access: mods.has('private') ? 'private' : mods.has('protected') ? 'protected' : 'public' };
    let name = ident(i), kind = 'method';
    if (!name && (src[i] === '\'' || src[i] === '"')) { const e = skipLiteral(i); name = src.slice(i + 1, e - 1); i = e; }
    else if (!name && src[i] === '[') { const e = close(i); name = src.slice(i, e + 1); i = e + 1; }
    else if (!name) return { end: i + 1 };
    else i += name.length;
    if (name.startsWith('#')) out.access = 'private';
    // `get x()` / `set x()` — but `get()` is a method named get.
    if ((name === 'get' || name === 'set') && src[ws(i)] !== '(' && src[ws(i)] !== '=' && src[ws(i)] !== ':' && src[ws(i)] !== ';') {
      kind = name;
      const j = ws(i);
      name = ident(j);
      if (!name) return { end: i };
      i = j + name.length;
    }
    let j = ws(i);
    if (src[j] === '?' || src[j] === '!') j = ws(j + 1);
    if (src[j] === '<') j = ws(until(j + 1, '>') + 1);
    if (src[j] === '(') {
      const pClose = close(j);
      const b = bodyAfter(pClose + 1);
      const end = b < 0 ? until(pClose + 1, ';') + 1 : close(b) + 1;
      return Object.assign(out, {
        name, kind: name === 'constructor' ? 'constructor' : kind,
        abstract: b < 0, pOpen: j, pClose, bodyOpen: b, bodyClose: b < 0 ? -1 : end - 1,
        sig: name + flat(j, b < 0 ? until(pClose + 1, ';') : b),
        start: lineAt(start), end: lineAt(Math.max(start, end - 1)), endIdx: end,
      });
    }
    // A property: `x = …`, `x: T = …`, `x: T;`. An arrow value makes it a
    // method; anything else is a field, kept with its type and initialiser so
    // a call on it can say what it lands on (`this.logger.log(` is a library
    // call, not a gap in a trace).
    let type = null;
    if (src[j] === ':') { const t = j + 1; j = until(t, '=;\n'); type = flat(t, j) || null; }
    const field = (init) => ({ name, type, init, static: out.static, line: lineAt(start) });
    if (src[j] === '=' && src[j + 1] !== '>') {
      const a = arrowAt(j + 1);
      if (a) {
        return Object.assign(out, {
          name, kind: 'arrow', async: out.async || a.async, abstract: false,
          pOpen: a.pOpen, pClose: a.pClose, bodyOpen: a.bodyOpen, bodyClose: a.bodyClose,
          sig: name + flat(a.pOpen, a.bodyOpen).replace(/\s*=>\s*$/, ''),
          start: lineAt(start), end: lineAt(Math.max(start, a.end - 1)), endIdx: a.end,
        });
      }
      const e = until(j + 1, ';\n');
      return { end: e + 1, field: field(flat(j + 1, e) || null) };
    }
    return { end: Math.min(bodyEnd, until(j, ';\n') + 1), field: field(null) };
  }

  function classBody(open, bodyClose) {
    const members = [], fields = [];
    let i = open + 1, decos = [], mods = new Set(), start = -1;
    while (i < bodyClose) {
      i = ws(i);
      if (i >= bodyClose) break;
      if (start < 0) start = i;
      const c = src[i];
      if (c === ';' || c === ',') { i++; start = -1; continue; }
      if (c === '@') { const d = decorator(i); decos.push(d.name); i = d.end; continue; }
      const w = ident(i);
      if (w && MODIFIERS.has(w)) {
        const after = ws(i + w.length);
        // `static(` or `async = …` would be a member named after the keyword
        if (!'(=:;?!<'.includes(src[after])) { mods.add(w); i = after; continue; }
      }
      const m = member(start, i, decos, mods, bodyClose);
      if (m.name) members.push(m);
      else if (m.field) fields.push(m.field);
      i = m.endIdx !== undefined ? m.endIdx : Math.max(m.end, i + 1);
      decos = []; mods = new Set(); start = -1;
    }
    return { members, fields };
  }

  function interfaceBody(open, bodyClose) {
    const members = [];
    let i = open + 1;
    while (i < bodyClose) {
      i = ws(i);
      if (i >= bodyClose) break;
      if (src[i] === ';' || src[i] === ',') { i++; continue; }
      let j = i;
      const w = ident(j);
      if (w === 'readonly') j = ws(j + w.length);
      const name = ident(j);
      if (!name) { i = until(i, ';,\n') + 1; continue; }
      j = ws(j + name.length);
      if (src[j] === '?') j = ws(j + 1);
      if (src[j] === '<') j = ws(until(j + 1, '>') + 1);
      const end = until(j, ';,\n');
      if (src[j] === '(') {
        members.push({ name, sig: name + flat(j, end), start: lineAt(i), end: lineAt(end) });
      } else if (src[j] === ':' && /^\s*(?:<[^>]*>\s*)?\(/.test(src.slice(j + 1, end)) && /=>/.test(src.slice(j + 1, end))) {
        members.push({ name, sig: name + ': ' + flat(j + 1, end), start: lineAt(i), end: lineAt(end) });
      }
      i = end + 1;
    }
    return members;
  }

  const classes = [], functions = [], interfaces = [];
  let i = 0, decos = [], mods = new Set(), start = -1;
  const reset = () => { decos = []; mods = new Set(); start = -1; };
  while (i < n) {
    i = ws(i);
    if (i >= n) break;
    if (start < 0) start = i;
    const c = src[i];
    const lit = skipLiteral(i);
    if (lit !== i) { i = lit; reset(); continue; }
    if (c === '@') { const d = decorator(i); decos.push(d.name); i = d.end; continue; }
    if (c === '(' || c === '[' || c === '{') { i = close(i) + 1; reset(); continue; }
    const w = ident(i);
    if (!w) { i++; reset(); continue; }
    if (w === 'export' || w === 'default' || w === 'abstract' || w === 'declare' || w === 'async') {
      mods.add(w); i += w.length; continue;
    }
    if (w === 'class') {
      let j = ws(i + 5);
      const name = ident(j) || (mods.has('default') ? 'default' : null);
      if (name && ident(j)) j += name.length;
      const open = until(j, '{');
      if (open >= n || src[open] !== '{') { i = j; reset(); continue; }
      const header = src.slice(j, open);
      const ext = header.match(/\bextends\s+([\w$.]+)/);
      const impl = header.match(/\bimplements\s+([\s\S]+)$/);
      const implementsList = impl
        ? impl[1].replace(/<[^<>]*>/g, '').split(',').map((x) => (x.trim().match(/^[\w$.]+/) || [])[0]).filter(Boolean)
        : [];
      const bodyClose = close(open);
      classes.push({
        name, exported: mods.has('export'), default: mods.has('default'), abstract: mods.has('abstract'),
        extends: ext ? ext[1] : null, implements: implementsList, decorators: decos,
        start: lineAt(start), end: lineAt(bodyClose), startIdx: start, open, close: bodyClose,
        ...classBody(open, bodyClose),
      });
      i = bodyClose + 1; reset(); continue;
    }
    if (w === 'interface') {
      let j = ws(i + 9);
      const name = ident(j);
      if (!name) { i = j; reset(); continue; }
      const open = until(j + name.length, '{');
      if (src[open] !== '{') { i = open; reset(); continue; }
      const bodyClose = close(open);
      interfaces.push({ name, exported: mods.has('export'), start: lineAt(start), end: lineAt(bodyClose),
        members: interfaceBody(open, bodyClose) });
      i = bodyClose + 1; reset(); continue;
    }
    if (w === 'function') {
      let j = ws(i + 8);
      if (src[j] === '*') j = ws(j + 1);
      const name = ident(j);
      if (!name) { i = j; reset(); continue; }
      j = ws(j + name.length);
      if (src[j] === '<') j = ws(until(j + 1, '>') + 1);
      if (src[j] !== '(') { i = j; reset(); continue; }
      const pClose = close(j);
      const b = bodyAfter(pClose + 1);
      if (b < 0) { i = until(pClose + 1, ';') + 1; reset(); continue; }   // an overload signature
      const bodyClose = close(b);
      functions.push({ name, exported: mods.has('export'), async: mods.has('async'),
        sig: name + flat(j, b), pOpen: j, pClose, bodyOpen: b, bodyClose,
        start: lineAt(start), end: lineAt(bodyClose) });
      i = bodyClose + 1; reset(); continue;
    }
    if (w === 'const' || w === 'let' || w === 'var') {
      let j = ws(i + w.length);
      const name = ident(j);
      if (name) {
        j = ws(j + name.length);
        if (src[j] === ':') j = until(j + 1, '=;\n');
        if (src[j] === '=') {
          const a = arrowAt(j + 1);
          let fn = a;
          if (!a) {
            // `const f = function (…) {…}` / `async function`
            const k = ws(j + 1);
            const fm = src.slice(k, k + 30).match(/^(async\s+)?function\b\s*\*?\s*[\w$]*\s*/);
            if (fm && src[k + fm[0].length] === '(') {
              const pOpen = k + fm[0].length, pClose = close(pOpen), b = bodyAfter(pClose + 1);
              if (b >= 0) fn = { async: !!fm[1], pOpen, pClose, bodyOpen: b, bodyClose: close(b), end: close(b) + 1 };
            }
          }
          if (fn) {
            functions.push({ name, exported: mods.has('export'), async: fn.async,
              sig: name + flat(fn.pOpen, fn.bodyOpen).replace(/\s*=>\s*$/, ''),
              pOpen: fn.pOpen, pClose: fn.pClose, bodyOpen: fn.bodyOpen, bodyClose: fn.bodyClose,
              start: lineAt(start), end: lineAt(Math.max(start, fn.end - 1)) });
            i = fn.end; reset(); continue;
          }
        }
      }
      i = until(i, ';\n') + 1; reset(); continue;
    }
    // Any other statement: step over it whole.
    i = until(i + w.length, ';\n') + 1;
    reset();
  }
  return { classes, functions, interfaces };
}

module.exports = { parse };

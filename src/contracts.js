'use strict';
/**
 * Contracts (spec 15): whether the two sides of a matched HTTP call declare
 * the same request and response shapes. Names, optionality and array-ness
 * are compared; field types are not. Each side is a shape (src/shapes.js) or
 * null, unread.
 *
 * A difference is between declarations: the runtime may still work. It is
 * reported, never gated.
 */

const required = (shape) => Object.keys(shape.fields).filter((k) => !shape.fields[k].optional);

/**
 * The request. `sent` is what the frontend declares it sends: a shape from a
 * named type (fields it may send), or `{ literal: [keys], open }` from an
 * object literal (keys it does send), or `{ none: true }`. `dto` is what the
 * endpoint reads: a shape, or `{ none: true }` when it takes no body.
 */
function compareRequest(sent, dto) {
  if (!sent) return { status: 'unread', why: 'the frontend body is not a literal or a typed name' };
  if (!dto) return { status: 'unread', why: 'the endpoint\'s body type is not readable' };
  if (sent.none && dto.none) return { status: 'agree' };
  if (dto.none) return { status: 'differ', why: 'the frontend sends a body the endpoint does not read' };
  if (dto.array || sent.array) return { status: 'unread', why: 'an array body' };
  if (sent.none) {
    const req = required(dto);
    return req.length ? { status: 'differ', why: 'the endpoint requires a body; the frontend sends none', missing: req } : { status: 'agree' };
  }
  const keys = sent.literal ? sent.literal : Object.keys(sent.fields);
  const open = !!sent.open;
  const extra = dto.open ? [] : keys.filter((k) => !dto.fields[k]);
  const missing = open ? [] : required(dto).filter((k) => !keys.includes(k));
  // a named type may leave out a field the DTO requires
  const optional = sent.literal ? [] : required(dto).filter((k) => sent.fields[k] && sent.fields[k].optional);
  if (!extra.length && !missing.length && !optional.length) return { status: 'agree' };
  return { status: 'differ', extra, missing, optional };
}

/**
 * The response. `expects` is the type the frontend expects back; `returns`
 * what the handler declares. A backend field the frontend ignores is not a
 * difference; a field the frontend requires and the backend does not
 * declare is.
 */
function compareResponse(expects, returns) {
  if (!expects) return { status: 'unread', why: 'the frontend declares no response type' };
  if (!returns) return { status: 'unread', why: 'the handler\'s return type is not readable' };
  if (expects.none) return { status: 'agree' };
  if (returns.none) return { status: 'differ', why: 'the frontend expects a body; the handler returns nothing' };
  if (!!expects.array !== !!returns.array) {
    return { status: 'differ', why: `the frontend expects ${expects.array ? 'an array' : 'an object'}; the handler returns ${returns.array ? 'an array' : 'an object'}` };
  }
  const e = expects.array ? expects.array : expects, r = returns.array ? returns.array : returns;
  if (!e || !r || !e.fields || !r.fields) return { status: 'unread', why: 'an element type is not readable' };
  const missing = r.open ? [] : required(e).filter((k) => !r.fields[k]);
  return missing.length ? { status: 'differ', missing } : { status: 'agree' };
}

// ------------------------------------------------------------ the models

const { shapeOf, typeIndex, lookupIn } = require('./shapes');

/**
 * The file `rel` imports `name` from, by the side's own resolver (the
 * scanner's: aliases, `src/` and relative specs). `rel` itself when the name
 * is not imported: it is declared there, if anywhere. Null when the import
 * names no file in the tree, a package's type.
 */
function importedFrom(text, rel, name, resolve) {
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text[rel] || ''))) {
    const names = m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim());
    if (names.includes(name)) return resolve(m[2], rel) || null;
  }
  return rel;
}

/**
 * Every matched HTTP call of a frontend model gets `contract`: its request
 * and response compared against the endpoint it reaches. Returns the counts.
 */
function contractsOf(fe, be) {
  const feText = fe.__text || {}, beText = be.__text || {};
  const feIndex = typeIndex(feText), beIndex = typeIndex(beText);
  const none = () => null;
  const feLook = (rel) => lookupIn(feIndex, (n) => importedFrom(feText, rel, n, fe.__resolve || none));
  const beLook = (rel) => lookupIn(beIndex, (n) => importedFrom(beText, rel, n, be.__resolve || none));
  const endpoints = new Map(be.endpoints.map((e) => [e.id, e]));
  const meta = { requests: { agree: 0, differ: 0, unread: 0 }, responses: { agree: 0, differ: 0, unread: 0 } };
  const drift = [];

  for (const c of fe.calls) {
    if (c.kind !== 'http' || c.match !== 'matched') continue;
    const e = endpoints.get(c.endpoint);
    const file = c.from.split('#')[0];
    const fl = feLook(file), bl = beLook(e.file);

    // what the frontend sends
    const b = c.body || { kind: 'none' };
    const sent = b.kind === 'none' ? { none: true }
      : b.kind === 'literal' ? { literal: b.keys, open: b.open }
        : b.kind === 'name' && b.type ? shapeOf(b.type, fl) : null;
    // what the endpoint reads
    const bodyParam = e.params.find((p) => p.deco === 'Body');
    const field = bodyParam && bodyParam.decoArg && /^[A-Za-z_$][\w$]*$/.test(bodyParam.decoArg.trim()) ? bodyParam.decoArg.trim() : null;
    const dto = !bodyParam ? { none: true }
      : field ? { fields: { [field]: { optional: false, type: bodyParam.type } }, open: false }
        : shapeOf(bodyParam.type, bl);
    const request = compareRequest(sent, dto);

    // what comes back
    const writesOwn = e.params.some((p) => p.deco === 'Res');
    const expects = c.expects ? shapeOf(c.expects, fl) : null;
    const returns = writesOwn || !e.retDeclared ? null : shapeOf(e.ret, bl);
    const response = writesOwn && expects ? { status: 'unread', why: 'the handler writes its own response (@Res)' }
      : !e.retDeclared && expects ? { status: 'unread', why: 'the handler declares no return type' }
        : compareResponse(expects, returns);

    c.contract = { request, response };
    meta.requests[request.status]++;
    meta.responses[response.status]++;
    if (request.status === 'differ' || response.status === 'differ') drift.push(c);
  }

  if (drift.length) {
    const say = (r) => [r.why, r.extra && r.extra.length ? 'sends ' + r.extra.join(', ') + ' (undeclared)' : '',
      r.missing && r.missing.length ? 'missing ' + r.missing.join(', ') : '',
      r.optional && r.optional.length ? 'optional here, required there: ' + r.optional.join(', ') : '']
      .filter(Boolean).join('; ');
    fe.findings.push({
      id: 'contract-drift', tone: 'warn', gate: false,
      title: `${drift.length} call${drift.length === 1 ? '' : 's'} where the frontend and backend declare different shapes`,
      detail: 'Compared by field name and optionality. The runtime may still work; one side\'s type promises what the other\'s does not.',
      items: drift.map((c) => `${c.from.split('#')[0]}:${c.line} ${c.verb} ${c.path}`
        + (c.contract.request.status === 'differ' ? ' · request: ' + say(c.contract.request) : '')
        + (c.contract.response.status === 'differ' ? ' · response: ' + say(c.contract.response) : '')),
      instances: drift.map((c) => ({ from: c.from.split('#')[0], to: `${c.verb} ${c.path}` })),
    });
  }
  return meta;
}

module.exports = { compareRequest, compareResponse, contractsOf, importedFrom };

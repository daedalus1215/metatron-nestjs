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

module.exports = { compareRequest, compareResponse };

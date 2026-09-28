'use strict';
/**
 * Calls on fields, and `this.x?.method(`. A call on a field holding a library
 * object (a Logger, a Map) is not a gap in a trace; a field typed as, or made
 * with `new`, a class in the tree is followed like an injected dependency;
 * `this.x` that is neither injected nor declared still stalls.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');

const files = {
  'things/apps/actions/get-thing.action.ts': `import { Controller, Get } from '@nestjs/common';
import { ThingService } from '../../domain/services/thing.service';

@Controller('things')
export class GetThingAction {
  constructor(private readonly svc: ThingService) {}

  @Get()
  run() {
    return this.svc?.find();
  }
}
`,
  'things/domain/services/thing.service.ts': `import { Injectable, Logger } from '@nestjs/common';
import { Helper } from './helper';

@Injectable()
export class ThingService {
  private readonly logger = new Logger(ThingService.name);
  private cache: Map<number, string> = new Map();
  private readonly helper = new Helper();
  private readonly typed: Helper;

  find() {
    this.logger.log('find');
    this.cache.get(1);
    this.helper.assist();
    this.typed.assist();
    return this.missing.go();
  }
}
`,
  'things/domain/services/helper.ts': `export class Helper {
  assist() { return 1; }
}
`,
};

const model = scan(Object.assign({}, nestjs, { name: 'f', root: '.', __dir: path.join(__dirname, 'fixtures') }), { files });
const SVC = 'things/domain/services/thing.service.ts';
const HELPER = 'things/domain/services/helper.ts#Helper';
const flat = model.endpoints.find((e) => e.route === '/things').flat;
const stalls = model.diagnostics.filter((d) => d.kind === 'trace-stalled');

test('this.x?.method( is followed like this.x.method(', () => {
  assert.deepStrictEqual(flat[0] && [flat[0].cls, flat[0].method], ['ThingService', 'find']);
  assert.ok(model.calls.some((c) => c.from.endsWith('#GetThingAction') && c.toMethod === 'find'));
});

test('a call on a library object held in a field is not a stall', () => {
  assert.ok(!stalls.some((d) => d.reason === 'field-unknown'));
  assert.ok(!flat.some((h) => h.method === 'log' || h.method === 'get'));
});

test('a field made with new, or typed as, an in-tree class is followed', () => {
  const hops = flat.filter((h) => h.method === 'assist');
  assert.strictEqual(hops.length, 1, 'both fields reach Helper.assist, reported once');
  assert.strictEqual(hops[0].viaField, true);
  const calls = model.calls.filter((c) => c.from === SVC + '#ThingService' && c.to === HELPER);
  assert.deepStrictEqual(calls.map((c) => c.field).sort(), ['helper', 'typed']);
  assert.ok(!model.wires.some((w) => w.to === HELPER), 'a field is not an injection: no wire');
});

test('this.x that is neither injected nor declared still stalls', () => {
  assert.deepStrictEqual(stalls.map((d) => [d.file, d.method, d.reason]), [[SVC, 'find', 'dep-not-injected']]);
});

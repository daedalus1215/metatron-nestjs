'use strict';
/**
 * Spec 11 — compare(base, head): what a change is, structurally. Pure: both
 * models are scanned from in-memory file maps, no git involved.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const { compare } = require('../src/change');

const cfg = Object.assign({}, nestjs, { name: 'change', root: '.', __dir: path.join(__dirname, 'fixtures') });
const model = (files) => scan(cfg, { files });

const ACTION = `import { Controller, Get } from '@nestjs/common';
import { AService } from '../../domain/services/a.service';

@Controller('a')
export class GetAAction {
  constructor(private readonly svc: AService) {}

  @Get()
  run() {
    return this.svc.find();
  }
}
`;
const REPO = `import { Injectable } from '@nestjs/common';

@Injectable()
export class ARepository {
  load() { return 1; }
  count() { return 2; }
}
`;
const C = `import { Injectable } from '@nestjs/common';

@Injectable()
export class CService {
  ping() { return 1; }
}
`;
const D = `import { Injectable } from '@nestjs/common';

@Injectable()
export class DService {
  x() { return 0; }
}
`;

const BASE = {
  'a/apps/actions/get-a.action.ts': ACTION,
  'a/infra/repositories/a.repository.ts': REPO,
  'a/domain/services/a.service.ts': `import { Injectable } from '@nestjs/common';
import { ARepository } from '../../infra/repositories/a.repository';

@Injectable()
export class AService {
  constructor(private readonly repo: ARepository) {}

  find() {
    return this.repo.load();
  }

  other() {
    return 1;
  }
}
`,
  'b/domain/services/b.service.ts': `import { Injectable } from '@nestjs/common';
import { ARepository } from '../../../a/infra/repositories/a.repository';

@Injectable()
export class BService {
  constructor(private readonly repo: ARepository) {}

  go() {
    return this.repo.count();
  }
}
`,
  'c/domain/services/c.service.ts': C,
  'd/domain/services/old-name.service.ts': D,
};

const HEAD = {
  'a/apps/actions/get-a.action.ts': ACTION,
  'a/infra/repositories/a.repository.ts': REPO,
  // edited: a new socket, and find() now reaches the new transaction script
  'a/domain/services/a.service.ts': `import { Injectable } from '@nestjs/common';
import { ARepository } from '../../infra/repositories/a.repository';
import { NewTs } from '../transaction-scripts/new.transaction.script';

@Injectable()
export class AService {
  constructor(
    private readonly repo: ARepository,
    private readonly newTs: NewTs,
  ) {}

  find() {
    this.newTs.apply();
    return this.repo.load();
  }

  other() {
    return 1;
  }
}
`,
  // added: leans on the existing repository, and on a new helper
  'a/domain/transaction-scripts/new.transaction.script.ts': `import { Injectable } from '@nestjs/common';
import { ARepository } from '../../infra/repositories/a.repository';
import { NewHelper } from '../services/new-helper.service';

@Injectable()
export class NewTs {
  constructor(
    private readonly repo: ARepository,
    private readonly helper: NewHelper,
  ) {}

  apply() {
    this.helper.help();
    return this.repo.load();
  }
}
`,
  'a/domain/services/new-helper.service.ts': `import { Injectable } from '@nestjs/common';

@Injectable()
export class NewHelper {
  help() { return 1; }
}
`,
  // rewired: B now sits on C instead of the repository
  'b/domain/services/b.service.ts': `import { Injectable } from '@nestjs/common';
import { CService } from '../../../c/domain/services/c.service';

@Injectable()
export class BService {
  constructor(private readonly c: CService) {}

  go() {
    return this.c.ping();
  }
}
`,
  // only moved down its file
  'c/domain/services/c.service.ts': C.replace('@Injectable()', '// a comment\n// another\n\n@Injectable()'),
  // renamed, same content
  'd/domain/services/new-name.service.ts': D,
};

const base = model(BASE);
const head = model(HEAD);
const out = compare(base, head, [['d/domain/services/old-name.service.ts', 'd/domain/services/new-name.service.ts']]);

const A = 'a/domain/services/a.service.ts#AService';
const NEW = 'a/domain/transaction-scripts/new.transaction.script.ts#NewTs';
const HELP = 'a/domain/services/new-helper.service.ts#NewHelper';
const REP = 'a/infra/repositories/a.repository.ts#ARepository';
const B = 'b/domain/services/b.service.ts#BService';
const CS = 'c/domain/services/c.service.ts#CService';
const pair = (from, to) => out.pairs.find((p) => p.from === from && p.to === to);

test('bricks: added, edited, unchanged', () => {
  assert.strictEqual(out.bricks[NEW], 'added');
  assert.strictEqual(out.bricks[HELP], 'added');
  assert.strictEqual(out.bricks[A], 'edited');
  assert.strictEqual(out.bricks[REP], 'unchanged');
  assert.strictEqual(out.bricks['a/apps/actions/get-a.action.ts#GetAAction'], 'unchanged');
});

test('a brick that only moved down its file is unchanged', () => {
  assert.strictEqual(out.bricks[CS], 'unchanged');
});

test('a renamed file is not removed plus added', () => {
  assert.strictEqual(out.bricks['d/domain/services/new-name.service.ts#DService'], 'unchanged');
  assert.deepStrictEqual(out.removed, []);
});

test('an edited brick names its edited studs; untouched ones stay unchanged', () => {
  assert.deepStrictEqual(out.studs[A], { find: 'edited', other: 'unchanged' });
});

test('new -> existing is an attachment; new -> new is territory', () => {
  assert.strictEqual(pair(NEW, REP).class, 'attachment');
  assert.deepStrictEqual(pair(NEW, REP).calls, ['apply > load']);
  assert.strictEqual(pair(NEW, HELP).class, 'territory');
});

test('existing -> new is a graft', () => {
  assert.strictEqual(pair(A, NEW).class, 'graft');
});

test('existing -> existing, new, is a rewire; the old pair is detached', () => {
  assert.strictEqual(pair(B, CS).class, 'rewire');
  assert.strictEqual(pair(B, REP).class, 'detached');
});

test('the summary leads with where the change meets the codebase', () => {
  const s = out.summary;
  assert.deepStrictEqual([s.added, s.edited, s.removed], [2, 2, 0]);   // AService, and BService (rewired)
  assert.deepStrictEqual(s.attachments.map((x) => [x.brick, x.with]), [[REP, [NEW]]]);
  assert.deepStrictEqual(s.grafts.map((x) => [x.brick, x.with]), [[A, [NEW]]]);
  assert.deepStrictEqual(s.rewires.map((x) => [x.from, x.to]), [[B, CS]]);
  assert.deepStrictEqual([s.territory, s.detached], [1, 1]);
});

test('a removed brick is listed, with where it lived', () => {
  const files = Object.assign({}, HEAD);
  delete files['a/domain/services/new-helper.service.ts'];
  const r = compare(head, model(files));
  assert.deepStrictEqual(r.removed.map((x) => x.id), [HELP]);
  assert.deepStrictEqual(r.removed[0].studs.map((x) => x.name), ['help'], 'the whole brick, as it was');
  assert.strictEqual(r.pairs.find((p) => p.to === HELP).class, 'detached');
});

test('comparing a model with itself finds nothing', () => {
  const r = compare(head, head);
  assert.ok(Object.values(r.bricks).every((s) => s === 'unchanged'));
  assert.deepStrictEqual(r.pairs, []);
});

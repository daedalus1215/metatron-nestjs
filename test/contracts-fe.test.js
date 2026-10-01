'use strict';
/**
 * Spec 15 — what a frontend call declares: the body it sends, and the type
 * it expects back. Fixture-free: an in-memory frontend.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const react = require('../src/defaults/react');

const files = {
  'api/axios.ts': "import axios from 'axios';\nconst api = axios.create({ baseURL: '/' });\nexport default api;\n",
  'api/folders.ts': `import api from './axios';
import type { FolderDto, NewFolder } from './types';

export const createFolder = async (data: { name: string; parentId?: number | null }): Promise<FolderDto> => {
  const res = await api.post('/folders', data);
  return res.data;
};
export const renameFolder = async (id: number, req: NewFolder) => (await api.patch<FolderDto>(\`/folders/\${id}\`, req)).data;
export const moveFolder = async (id: number, parentId: number | null) => {
  await api.patch(\`/folders/\${id}/move\`, { parentId, ...extra(), position: 1 });
};
export const tidy = async () => {
  const body: NewFolder = { name: 'x' };
  await api.post('/folders/tidy', body);
};
export const listTwice = async (): Promise<FolderDto[]> => {
  await api.get('/folders');
  return (await api.get('/folders')).data;
};
export const viaFetch = async (draft: NewFolder) => fetch('/api/folders', { method: 'POST', body: JSON.stringify(draft) });
const extra = () => ({});
`,
  'api/types.ts': 'export type FolderDto = { id: number; name: string };\nexport type NewFolder = { name: string };\n',
};
const m = scan(Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react') }), { files });
const calls = m.calls.filter((c) => c.kind === 'http');
const by = (fn) => calls.filter((c) => c.fromMethod === fn);

test("a body named by a parameter takes the parameter's type, inline or named", () => {
  assert.deepStrictEqual(by('createFolder')[0].body, { kind: 'name', name: 'data', type: '{ name: string; parentId?: number | null }' });
  assert.deepStrictEqual(by('renameFolder')[0].body, { kind: 'name', name: 'req', type: 'NewFolder' });
});

test('a literal body gives its keys, and a spread opens it', () => {
  assert.deepStrictEqual(by('moveFolder')[0].body, { kind: 'literal', keys: ['parentId', 'position'], open: true });
});

test('a local const with a type annotation', () => {
  assert.deepStrictEqual(by('tidy')[0].body, { kind: 'name', name: 'body', type: 'NewFolder' });
});

test("the expected response: the call's generic, else its one-call function's return type", () => {
  assert.deepStrictEqual([by('renameFolder')[0].expects, by('renameFolder')[0].expectsFrom], ['FolderDto', 'generic']);
  assert.deepStrictEqual([by('createFolder')[0].expects, by('createFolder')[0].expectsFrom], ['Promise<FolderDto>', 'return']);
  assert.ok(by('listTwice').every((c) => c.expects === null), 'two calls: the return type belongs to neither');
});

test('fetch sends what it stringifies', () => {
  assert.deepStrictEqual(by('viaFetch')[0].body, { kind: 'name', name: 'draft', type: 'NewFolder' });
});

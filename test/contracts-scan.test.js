'use strict';
/**
 * Spec 15 — contractsOf() in the scan: each matched call's request and
 * response, compared against the endpoint it reaches. Fixture-free: an
 * in-memory backend and frontend.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const scan = require('../src/scan');
const nestjs = require('../src/defaults/nestjs');
const react = require('../src/defaults/react');
const { violationsOf } = require('../src/violations');

const action = (name, verb, route, sig, ret) => `import { Body, Controller, ${verb}, Param, Res } from '@nestjs/common';
import { CreateFolderDto } from '../dtos/create-folder.dto';
import { FolderResponseDto } from '../dtos/folder.response.dto';

@Controller('folders')
export class ${name} {
  @${verb}(${route ? `'${route}'` : ''})
  async apply(${sig})${ret ? ': ' + ret : ''} {
    return null as any;
  }
}
`;
const BE = {
  'folders/apps/dtos/create-folder.dto.ts': `import { IsOptional, IsString } from 'class-validator';
export class CreateFolderDto {
  @IsString()
  name: string;

  @IsOptional()
  parentId: number;
}
`,
  'folders/apps/dtos/folder.response.dto.ts': 'export class FolderResponseDto {\n  id: number;\n  name: string;\n}\n',
  'folders/apps/actions/create-folder.action.ts': action('CreateFolderAction', 'Post', '', '@Body() dto: CreateFolderDto', 'Promise<FolderResponseDto>'),
  'folders/apps/actions/rename-folder.action.ts': action('RenameFolderAction', 'Patch', ':id', "@Param('id') id: number, @Body('name') name: string", 'Promise<FolderResponseDto>'),
  'folders/apps/actions/list-folders.action.ts': action('ListFoldersAction', 'Get', '', '', 'Promise<FolderResponseDto[]>'),
  'folders/apps/actions/export-folder.action.ts': action('ExportFolderAction', 'Get', ':id/export', "@Param('id') id: number, @Res() res: any", 'Promise<void>'),
  'folders/apps/actions/get-folder.action.ts': action('GetFolderAction', 'Get', ':id', "@Param('id') id: number", null),
};
const FE = {
  'api/axios.ts': "import axios from 'axios';\nconst api = axios.create({ baseURL: '/' });\nexport default api;\n",
  'api/types.ts': 'export type Folder = { id: number; name: string; color: string };\nexport type FolderRow = { id: number; name: string };\n',
  // another `Folder`: the call's import decides which one it means
  'components/FolderChip.tsx': 'type Folder = { label: string };\nexport const FolderChip = (p: { f: Folder }) => <span>{p.f.label}</span>;\n',
  'api/folders.ts': `import api from './axios';
import type { Folder, FolderRow } from './types';

export const createFolder = async (name: string) => (await api.post<FolderRow>('/folders', { name, parentId: null })).data;
export const createLoose = async () => api.post('/folders', { title: 'x' });
export const renameFolder = async (id: number, name: string) => api.patch<Folder>(\`/folders/\${id}\`, { name });
export const listFolders = async (): Promise<FolderRow> => (await api.get('/folders')).data;
export const exportFolder = async (id: number) => api.get<Folder>(\`/folders/\${id}/export\`);
export const getFolder = async (id: number) => api.get<Folder>(\`/folders/\${id}\`);
`,
};

const bcfg = Object.assign({}, nestjs, { name: 'be', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react-backend') });
const fcfg = Object.assign({}, react, { name: 'fe', root: 'src', __dir: path.join(__dirname, 'fixtures', 'react') });
const be = scan(bcfg, { files: BE });
const fe = scan(fcfg, { files: FE, backend: { model: be, label: 'be', cfg: bcfg } });
const of = (fn) => fe.calls.find((c) => c.kind === 'http' && c.fromMethod === fn).contract;

test('a request: a literal against a DTO, with @IsOptional and @Body(field)', () => {
  assert.deepStrictEqual(of('createFolder').request, { status: 'agree' });
  assert.deepStrictEqual(of('createLoose').request, { status: 'differ', extra: ['title'], missing: ['name'], optional: [] });
  assert.deepStrictEqual(of('renameFolder').request, { status: 'agree' });
  assert.deepStrictEqual(of('getFolder').request, { status: 'agree' }, 'no body on either side');
});

test("a response: through the call's own import, arrays, @Res and an undeclared return", () => {
  assert.deepStrictEqual(of('createFolder').response, { status: 'agree' });
  assert.deepStrictEqual(of('renameFolder').response, { status: 'differ', missing: ['color'] });
  assert.strictEqual(of('listFolders').response.status, 'differ');
  assert.match(of('listFolders').response.why, /expects an object; the handler returns an array/);
  assert.match(of('exportFolder').response.why, /@Res/);
  assert.match(of('getFolder').response.why, /declares no return type/);
});

test('contractMeta counts both; contract-drift lists each call that differs, and is not gated', () => {
  assert.deepStrictEqual(fe.contractMeta, {
    requests: { agree: 5, differ: 1, unread: 0 },
    responses: { agree: 1, differ: 2, unread: 3 },
  });
  const f = fe.findings.find((x) => x.id === 'contract-drift');
  assert.strictEqual(f.gate, false);
  assert.deepStrictEqual(f.items, [
    "api/folders.ts:5 POST /folders · request: sends title (undeclared); missing name",
    'api/folders.ts:6 PATCH /folders/${id} · response: missing color',
    'api/folders.ts:7 GET /folders · response: the frontend expects an object; the handler returns an array',
  ]);
  assert.ok(!violationsOf(fe).some((v) => v.rule === 'contract-drift'), 'advisory, never a violation');
});

test('the backend model does not carry what contracts read', () => {
  const e = be.endpoints.find((x) => x.handler === 'apply' && x.cls === 'GetFolderAction');
  assert.strictEqual(e.ret, 'void');
  assert.ok(!('retDeclared' in JSON.parse(JSON.stringify(e))));
  assert.ok(!Object.keys(be).includes('__resolve'));
});

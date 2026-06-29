import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const REQUIRED = [
  '/api/review', '/api/ping', '/api/version-check',
  '/api/settings', '/api/settings/reset',
  '/api/editor-annotations', '/api/editor-annotation',
  '/api/chat/session', '/api/chat/query', '/api/chat/abort',
  '/api/implement', '/api/save', '/api/done',
];
test('all required routes present in server source', () => {
  const src = [
    'packages/server/src/index.ts',
    'packages/server/src/editor-annotations.ts',
  ].map(path => readFileSync(path, 'utf8')).join('\n');
  for (const r of REQUIRED) expect(src.includes(r), `missing route ${r}`).toBe(true);
});

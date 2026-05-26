import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const REQUIRED = [
  '/api/review', '/api/version-check',
  '/api/chat/session', '/api/chat/query', '/api/chat/abort',
  '/api/implement', '/api/save', '/api/done',
];
test('all required routes present in server index.ts', () => {
  const src = readFileSync('packages/server/src/index.ts', 'utf8');
  for (const r of REQUIRED) expect(src.includes(r), `missing route ${r}`).toBe(true);
});

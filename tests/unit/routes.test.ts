// NOTE: process.argv must be set before config.ts is imported (imports are hoisted).
// We rely on Bun's --preload or on the default session='unknown' path.
// The fixture is copied to the path that config.ts resolves via the default session.

import { describe, test, expect, afterAll } from 'bun:test';
import { copyFileSync, unlinkSync } from 'node:fs';
import { compareSemver } from '../../packages/server/src/routes/version';

const DEFAULT_FX = '/tmp/claude-code-review-unknown.json';
copyFileSync('tests/fixtures/sample-review.json', DEFAULT_FX);
afterAll(() => { try { unlinkSync(DEFAULT_FX); } catch {} });

describe('handleReview', () => {
  test('returns parsed findings from file', async () => {
    const { handleReview } = await import('../../packages/server/src/routes/review');
    const data = await handleReview().json();
    expect(data.findings).toHaveLength(3);
    expect(data.findings[0].severity).toBe('CRITICAL');
  });
  test('readFindings returns valid shape', async () => {
    const { readFindings } = await import('../../packages/server/src/findings');
    const data = readFindings();
    expect(Array.isArray(data.findings)).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
  });
});

describe('compareSemver', () => {
  test('a > b → 1', () => expect(compareSemver('1.2.0','1.1.9')).toBe(1));
  test('a < b → -1', () => expect(compareSemver('1.1.0','1.1.1')).toBe(-1));
  test('equal → 0', () => expect(compareSemver('1.1.1','1.1.1')).toBe(0));
  test('different lengths', () => expect(compareSemver('1.0','1.0.1')).toBe(-1));
});

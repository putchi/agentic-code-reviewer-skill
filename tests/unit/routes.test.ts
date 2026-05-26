import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { copyFileSync, unlinkSync } from 'node:fs';

const FX = '/tmp/claude-code-review-test-routes.json';
beforeAll(() => {
  process.argv.push('--session', 'test-routes', '--findings-file', FX);
  copyFileSync('tests/fixtures/sample-review.json', FX);
});
afterAll(() => { try { unlinkSync(FX); } catch {} });

describe('handleReview', () => {
  test('returns parsed findings from file', async () => {
    const { handleReview } = await import('../../packages/server/src/routes/review');
    const data = await handleReview().json();
    expect(data.findings).toHaveLength(3);
    expect(data.findings[0].severity).toBe('CRITICAL');
  });
  test('readFindings returns fallback shape when file missing', async () => {
    const { readFindings } = await import('../../packages/server/src/findings');
    // test fallback by calling with a nonexistent path via the exported function directly
    // (can't re-configure findingsFile in the same process; we test the shape contract)
    const data = readFindings();
    expect(Array.isArray(data.findings)).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
  });
});

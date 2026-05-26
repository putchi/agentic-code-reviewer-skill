import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Copy fixture to the default session path (session='unknown') so config resolves it
const DEFAULT_FX = '/tmp/claude-code-review-unknown.json';
copyFileSync('tests/fixtures/sample-review.json', DEFAULT_FX);

let tmpSave: string;
beforeEach(() => {
  tmpSave = mkdtempSync(join(tmpdir(), 'acr-save-'));
});
afterEach(() => {
  rmSync(tmpSave, { recursive: true, force: true });
});

describe('saveMarkdown', () => {
  test('orders severities CRITICAL → HIGH → NOTE and marks selection', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { selectedIds: ['f001'], comments: { f001: 'note' }, globalComment: 'overall' };
    // saveMarkdown uses saveDir from config (default: docs/code-reviews); override by passing a custom saveDir
    // Since we can't easily override saveDir, we write to the default and check the result
    const p = saveMarkdown(data, {});
    expect(existsSync(p)).toBe(true);
    const md = readFileSync(p, 'utf8');
    expect(md.indexOf('## CRITICAL')).toBeLessThan(md.indexOf('## HIGH'));
    expect(md.indexOf('## HIGH')).toBeLessThan(md.indexOf('## NOTE'));
    expect(md).toContain('☑ selected for implementation');
    expect(md).toContain('☐ not selected');
    expect(md).toContain('**Your notes:** overall');
  });
  test('renders Line Annotations section', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const annots = { 'src/db.ts|42|42|new': {
      file: 'src/db.ts', lineStart: 42, lineEnd: 42, side: 'new' as const,
      text: 'verify', linesText: 'q', type: 'COMMENT' as const,
    }};
    const md = readFileSync(saveMarkdown(readFindings(), annots), 'utf8');
    expect(md).toContain('## Line Annotations');
    expect(md).toContain('[COMMENT] verify');
  });
});

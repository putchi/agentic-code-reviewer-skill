import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync, mkdtempSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectPlatform, buildInstallCommand } from '../../packages/server/src/config';

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

describe('readFindings', () => {
  const FIXTURE = '/tmp/claude-code-review-unknown.json';
  const BACKUP = '/tmp/claude-code-review-unknown.json.bak';

  test('returns parsed findings when file exists', async () => {
    const { readFindings } = await import('../../packages/server/src/findings');
    const data = readFindings();
    expect(typeof data.verdict).toBe('string');
    expect(Array.isArray(data.findings)).toBe(true);
    expect(typeof data.sessionId).toBe('string');
  });

  test('returns default shape when file does not exist (catch path)', async () => {
    // Temporarily hide the fixture to trigger the catch block
    if (existsSync(FIXTURE)) {
      copyFileSync(FIXTURE, BACKUP);
      unlinkSync(FIXTURE);
    }
    try {
      const { readFindings } = await import('../../packages/server/src/findings');
      const data = readFindings();
      expect(data.verdict).toBe('');
      expect(Array.isArray(data.findings)).toBe(true);
      expect(data.findings).toHaveLength(0);
      expect(Array.isArray(data.files)).toBe(true);
      expect(typeof data.timestamp).toBe('string');
    } finally {
      if (existsSync(BACKUP)) {
        copyFileSync(BACKUP, FIXTURE);
        unlinkSync(BACKUP);
      }
    }
  });
});

describe('detectPlatform / buildInstallCommand', () => {
  test('detectPlatform returns a string (possibly empty in dev)', () => {
    const p = detectPlatform();
    expect(typeof p).toBe('string');
  });
  test('buildInstallCommand returns a non-empty string', () => {
    const cmd = buildInstallCommand();
    expect(typeof cmd).toBe('string');
    expect(cmd.length).toBeGreaterThan(0);
  });
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

  test('dismissed findings appear in Dismissed Findings section', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { dismissedIds: ['f002'], dismissReasons: {} };
    const md = readFileSync(saveMarkdown(data, {}), 'utf8');
    expect(md).toContain('## Dismissed Findings');
    expect(md).toContain('src/worker.ts:17');
  });

  test('dismissed findings are excluded from active severity sections', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { dismissedIds: ['f002'], dismissReasons: {} };
    const md = readFileSync(saveMarkdown(data, {}), 'utf8');
    // f002 should not appear under HIGH as an active finding
    const highSection = md.slice(md.indexOf('## HIGH'), md.indexOf('## NOTE'));
    expect(highSection).not.toContain('Race condition on shared cache');
    // but it should be in the dismissed section
    expect(md.slice(md.indexOf('## Dismissed Findings'))).toContain('Race condition on shared cache');
  });

  test('dismiss reason is rendered when provided', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { dismissedIds: ['f001'], dismissReasons: { f001: 'false positive — input is sanitized upstream' } };
    const md = readFileSync(saveMarkdown(data, {}), 'utf8');
    expect(md).toContain('Reason: false positive — input is sanitized upstream');
  });

  test('Dismissed Findings section is absent when dismissedIds is empty', async () => {
    const { readFindings, saveMarkdown } = await import('../../packages/server/src/findings');
    const data: any = readFindings();
    data._decision = { dismissedIds: [], dismissReasons: {} };
    const md = readFileSync(saveMarkdown(data, {}), 'utf8');
    expect(md).not.toContain('## Dismissed Findings');
  });
});

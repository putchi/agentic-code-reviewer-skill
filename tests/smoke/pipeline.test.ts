import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReviewFromRunDir } from '../../packages/server/src/findings';
import { validateDecisionsFile } from '../../packages/shared/src/types/index';
import { zodValidateDecisionsFile } from '../../packages/server/src/schemas';

const FIXTURES = 'tests/fixtures/smoke';
const AGENTS = [
  'semantic-analyzer',
  'security-scanner',
  'architecture-reviewer',
  'test-coverage-analyzer',
  'senior-dev-reviewer',
] as const;

/**
 * Build a temporary run directory that mirrors the layout expected by
 * readReviewFromRunDir:
 *   {dir}/synthesis.json
 *   {dir}/agents/{agent}.json  (for each of the 5 known agents)
 */
function buildRunDir(fixture: 'known-bad' | 'known-good'): string {
  const tmp = mkdtempSync(join(tmpdir(), `acr-smoke-${fixture}-`));
  const agentsDir = join(tmp, 'agents');
  mkdirSync(agentsDir);
  copyFileSync(
    join(FIXTURES, fixture, 'synthesis.json'),
    join(tmp, 'synthesis.json'),
  );
  for (const agent of AGENTS) {
    copyFileSync(
      join(FIXTURES, fixture, `${agent}.json`),
      join(agentsDir, `${agent}.json`),
    );
  }
  return tmp;
}

let tmpDirs: string[] = [];
beforeEach(() => { tmpDirs = []; });
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ---- readReviewFromRunDir ----

describe('readReviewFromRunDir — known-bad', () => {
  test('returns ReviewData with at least one CRITICAL finding', () => {
    const dir = buildRunDir('known-bad');
    tmpDirs.push(dir);
    const data = readReviewFromRunDir(dir);
    expect(data).not.toBeNull();
    const criticals = data!.findings.filter(f => f.severity === 'CRITICAL');
    expect(criticals.length).toBeGreaterThanOrEqual(1);
  });

  test('run_id matches the known-bad fixture value', () => {
    const dir = buildRunDir('known-bad');
    tmpDirs.push(dir);
    const data = readReviewFromRunDir(dir);
    expect(data).not.toBeNull();
    expect(data!.runId).toBe('test-run-known-bad');
  });
});

describe('readReviewFromRunDir — known-good', () => {
  test('returns ReviewData with 0 findings', () => {
    const dir = buildRunDir('known-good');
    tmpDirs.push(dir);
    const data = readReviewFromRunDir(dir);
    expect(data).not.toBeNull();
    expect(data!.findings).toHaveLength(0);
  });

  test('verdict is non-empty', () => {
    const dir = buildRunDir('known-good');
    tmpDirs.push(dir);
    const data = readReviewFromRunDir(dir);
    expect(data).not.toBeNull();
    expect(data!.verdict.length).toBeGreaterThan(0);
  });
});

describe('readReviewFromRunDir — invalid synthesis', () => {
  test('returns null when synthesis.json fails schema validation', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acr-smoke-bad-synthesis-'));
    tmpDirs.push(tmp);
    // Write a synthesis with empty two_sentence_verdict (fails .min(1))
    const badSynthesis = {
      run_id: 'test-bad',
      two_sentence_verdict: '',          // violates .min(1)
      deduped_findings: [],
      dropped_findings_with_reason: [],
      contradictions_resolved: [],
      severity_rationale: {},
      recommended_next_actions: [],
      source_agent_result_files: [],
    };
    writeFileSync(join(tmp, 'synthesis.json'), JSON.stringify(badSynthesis));
    const result = readReviewFromRunDir(tmp);
    expect(result).toBeNull();
  });
});

// ---- validateDecisionsFile / zodValidateDecisionsFile ----

describe('validateDecisionsFile — structure checks', () => {
  test('type guard accepts a fully-populated decisions object', () => {
    const decisions = {
      run_id: 'test-run-known-bad',
      decided_at: new Date().toISOString(),
      global_comment: 'looks bad',
      findings: {
        f1: { action: 'ask_claude_to_implement', comment: 'fix the injection' },
        f2: { action: 'ignore' },
        f3: { action: 'create_follow_up_task' },
        f4: { action: 'ask_claude_to_explain' },
        f5: { action: 'accept_fix' },
      },
    };
    expect(validateDecisionsFile(decisions)).toBe(true);
  });

  test('type guard rejects when findings_by_action key is misspelled', () => {
    const invalid = {
      run_id: 'test-run-001',
      decided_at: new Date().toISOString(),
      findings: {
        f1: { action: 'implement_it' },    // not a valid action
      },
    };
    expect(validateDecisionsFile(invalid)).toBe(false);
  });
});

describe('zodValidateDecisionsFile — resume artifact structure', () => {
  test('decisions with ask_claude_to_implement validate and produce expected keys', () => {
    const decisions = {
      run_id: 'test-run-known-bad',
      decided_at: new Date().toISOString(),
      findings: {
        f1: { action: 'ask_claude_to_implement' },
        f2: { action: 'ignore' },
      },
    };
    const result = zodValidateDecisionsFile(decisions);
    expect(result.success).toBe(true);
    // Verify the parsed data has the expected shape
    const findingKeys = Object.keys(result.data!.findings);
    expect(findingKeys).toContain('f1');
    expect(findingKeys).toContain('f2');
    expect(result.data!.findings['f1'].action).toBe('ask_claude_to_implement');
  });

  test('success=false with error when run_id is missing', () => {
    const result = zodValidateDecisionsFile({
      decided_at: new Date().toISOString(),
      findings: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

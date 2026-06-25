import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateRawReviewerResult,
  validateSynthesisResult,
  validateDecisionsFile,
} from '../../packages/shared/src/types/index';
import {
  zodValidateRawReviewerResult,
  zodValidateSynthesisResult,
  zodValidateDecisionsFile,
} from '../../packages/server/src/schemas';

const FIXTURES = 'tests/fixtures/smoke';
const AGENTS = [
  'semantic-analyzer',
  'security-scanner',
  'architecture-reviewer',
  'test-coverage-analyzer',
  'senior-dev-reviewer',
] as const;

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('plugin hooks manifest', () => {
  test('has only hooks as a top-level field', () => {
    const data = loadJson('hooks/hooks.json') as Record<string, unknown>;

    expect(Object.keys(data).sort()).toEqual(['hooks']);
    expect(data.hooks).toBeDefined();
  });
});

// ---- validateRawReviewerResult ----

describe('validateRawReviewerResult — known-bad fixtures', () => {
  for (const agent of AGENTS) {
    test(`accepts known-bad/${agent}.json`, () => {
      const data = loadJson(join(FIXTURES, 'known-bad', `${agent}.json`));
      expect(validateRawReviewerResult(data)).toBe(true);
    });
  }
});

describe('validateRawReviewerResult — known-good fixtures', () => {
  for (const agent of AGENTS) {
    test(`accepts known-good/${agent}.json`, () => {
      const data = loadJson(join(FIXTURES, 'known-good', `${agent}.json`));
      expect(validateRawReviewerResult(data)).toBe(true);
    });
  }
});

describe('validateRawReviewerResult — malformed fixture', () => {
  test('rejects malformed-reviewer.json (missing agent and findings)', () => {
    const data = loadJson(join(FIXTURES, 'malformed-reviewer.json'));
    expect(validateRawReviewerResult(data)).toBe(false);
  });
});

// ---- validateSynthesisResult ----

describe('validateSynthesisResult', () => {
  test('accepts known-bad/synthesis.json', () => {
    const data = loadJson(join(FIXTURES, 'known-bad', 'synthesis.json'));
    expect(validateSynthesisResult(data)).toBe(true);
  });

  test('accepts known-good/synthesis.json', () => {
    const data = loadJson(join(FIXTURES, 'known-good', 'synthesis.json'));
    expect(validateSynthesisResult(data)).toBe(true);
  });

  test('rejects synthesis with empty two_sentence_verdict', () => {
    const valid = loadJson(join(FIXTURES, 'known-good', 'synthesis.json')) as Record<string, unknown>;
    const invalid = { ...valid, two_sentence_verdict: '' };
    expect(validateSynthesisResult(invalid)).toBe(false);
  });
});

// ---- validateDecisionsFile ----

describe('validateDecisionsFile', () => {
  test('accepts a well-formed decisions object', () => {
    const decisions = {
      run_id: 'test-run-001',
      decided_at: new Date().toISOString(),
      findings: {
        f1: { action: 'accept_fix' },
        f2: { action: 'ignore', comment: 'not relevant' },
      },
    };
    expect(validateDecisionsFile(decisions)).toBe(true);
  });

  test('rejects an object with an invalid action value', () => {
    const decisions = {
      run_id: 'test-run-001',
      decided_at: new Date().toISOString(),
      findings: {
        f1: { action: 'delete_it_all' },
      },
    };
    expect(validateDecisionsFile(decisions)).toBe(false);
  });

  test('rejects an object missing run_id', () => {
    const decisions = {
      decided_at: new Date().toISOString(),
      findings: {},
    };
    expect(validateDecisionsFile(decisions)).toBe(false);
  });
});

// ---- Zod variants: zodValidateRawReviewerResult ----

describe('zodValidateRawReviewerResult', () => {
  test('returns success=false and error defined for malformed data', () => {
    const data = loadJson(join(FIXTURES, 'malformed-reviewer.json'));
    const result = zodValidateRawReviewerResult(data);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('returns success=true and data defined for valid reviewer', () => {
    const data = loadJson(join(FIXTURES, 'known-good', 'semantic-analyzer.json'));
    const result = zodValidateRawReviewerResult(data);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});

// ---- Zod variants: zodValidateSynthesisResult ----

describe('zodValidateSynthesisResult', () => {
  test('returns success=false for empty two_sentence_verdict', () => {
    const valid = loadJson(join(FIXTURES, 'known-good', 'synthesis.json')) as Record<string, unknown>;
    const result = zodValidateSynthesisResult({ ...valid, two_sentence_verdict: '' });
    expect(result.success).toBe(false);
  });

  test('returns success=true for valid synthesis', () => {
    const data = loadJson(join(FIXTURES, 'known-bad', 'synthesis.json'));
    const result = zodValidateSynthesisResult(data);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});

// ---- Zod variants: zodValidateDecisionsFile ----

describe('zodValidateDecisionsFile', () => {
  test('returns success=false for unknown action', () => {
    const decisions = {
      run_id: 'test-run-001',
      decided_at: new Date().toISOString(),
      findings: { f1: { action: 'not_a_real_action' } },
    };
    const result = zodValidateDecisionsFile(decisions);
    expect(result.success).toBe(false);
  });

  test('returns success=true for all valid actions', () => {
    const actions = ['accept_fix', 'ignore', 'create_follow_up_task', 'ask_claude_to_explain', 'ask_claude_to_implement'];
    for (const action of actions) {
      const decisions = {
        run_id: 'test-run-001',
        decided_at: new Date().toISOString(),
        findings: { f1: { action } },
      };
      const result = zodValidateDecisionsFile(decisions);
      expect(result.success).toBe(true);
    }
  });
});

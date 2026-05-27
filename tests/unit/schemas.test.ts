import { describe, expect, test } from 'bun:test';
import { bucketDecisionActions, validateDecisionsFile, validateRawReviewerResult, validateSynthesisResult } from '../../packages/shared/src/types';

describe('review schemas', () => {
  test('validates raw reviewer result shape', () => {
    expect(validateRawReviewerResult({
      run_id: 'r1',
      agent: 'semantic-analyzer',
      status: 'complete',
      started_at: '2026-05-27T00:00:00Z',
      completed_at: '2026-05-27T00:00:01Z',
      error: null,
      findings: [],
    })).toBe(true);
  });

  test('rejects invalid reviewer agent', () => {
    expect(validateRawReviewerResult({
      run_id: 'r1',
      agent: 'unknown',
      status: 'complete',
      started_at: 'x',
      completed_at: 'y',
      error: null,
      findings: [],
    })).toBe(false);
  });

  test('validates synthesis shape', () => {
    expect(validateSynthesisResult({
      run_id: 'r1',
      two_sentence_verdict: 'Ship it. Nothing else.',
      deduped_findings: [],
      dropped_findings_with_reason: [],
      contradictions_resolved: [],
      severity_rationale: {},
      recommended_next_actions: [],
      source_agent_result_files: [],
    })).toBe(true);
  });

  test('validates decisions and buckets all five actions', () => {
    const decisions = {
      run_id: 'r1',
      decided_at: '2026-05-27T00:00:00Z',
      findings: {
        f1: { action: 'accept_fix' },
        f2: { action: 'ignore' },
        f3: { action: 'create_follow_up_task' },
        f4: { action: 'ask_claude_to_explain' },
        f5: { action: 'ask_claude_to_implement' },
      },
    } as const;
    expect(validateDecisionsFile(decisions)).toBe(true);
    expect(bucketDecisionActions(decisions)).toEqual({
      accept_fix: ['f1'],
      ignore: ['f2'],
      create_follow_up_task: ['f3'],
      ask_claude_to_explain: ['f4'],
      ask_claude_to_implement: ['f5'],
    });
  });
});

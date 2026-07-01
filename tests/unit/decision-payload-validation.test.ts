import { describe, expect, test } from 'bun:test';
import { validateDecisionPayload } from '../../packages/server/src/routes/decisions';
import type { DecisionPayload } from '@acr/shared';

describe('validateDecisionPayload', () => {
  test('accepts a valid payload', () => {
    const payload = {
      runId: 'r1',
      findingDecisions: {
        f1: { action: 'accept_fix' },
        f2: { action: 'ignore', comment: 'not relevant' },
      },
    } as DecisionPayload;
    expect(validateDecisionPayload(payload)).toBeNull();
  });

  test('accepts a payload without findingDecisions (legacy selectedIds path)', () => {
    expect(validateDecisionPayload({ selectedIds: ['f1'] } as DecisionPayload)).toBeNull();
  });

  test('rejects a non-object payload', () => {
    expect(validateDecisionPayload(null as unknown as DecisionPayload)).toContain('object');
  });

  test('rejects an unknown action', () => {
    const payload = { findingDecisions: { f1: { action: 'delete_everything' } } } as unknown as DecisionPayload;
    expect(validateDecisionPayload(payload)).toContain('invalid action');
  });

  test('rejects a missing action', () => {
    const payload = { findingDecisions: { f1: { comment: 'no action' } } } as unknown as DecisionPayload;
    expect(validateDecisionPayload(payload)).toContain('invalid action');
  });

  test('rejects an array findingDecisions', () => {
    const payload = { findingDecisions: [] } as unknown as DecisionPayload;
    expect(validateDecisionPayload(payload)).toContain('must be an object');
  });
});

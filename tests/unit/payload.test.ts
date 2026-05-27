import { describe, test, expect } from 'bun:test';
import { buildDecisionPayload } from '../../packages/shared/src/types/payload';

const emptyParams = {
  checkedIds: new Set<string>(),
  comments: {},
  lineAnnotations: {},
  dismissedIds: new Set<string>(),
  dismissReasons: {},
};

describe('buildDecisionPayload', () => {
  test('converts checkedIds Set to selectedIds array', () => {
    const result = buildDecisionPayload({ ...emptyParams, checkedIds: new Set(['a', 'b']) });
    expect(result.selectedIds).toEqual(['a', 'b']);
  });

  test('strips _comment_ prefix and maps to finding id', () => {
    const result = buildDecisionPayload({ ...emptyParams, comments: { '_comment_f001': 'looks good' } });
    expect(result.comments).toEqual({ f001: 'looks good' });
  });

  test('drops comment entries with empty string values', () => {
    const result = buildDecisionPayload({ ...emptyParams, comments: { '_comment_f001': '', '_comment_f002': 'keep' } });
    expect(result.comments).toEqual({ f002: 'keep' });
    expect('f001' in result.comments).toBe(false);
  });

  test('keeps direct finding-id comment keys', () => {
    const result = buildDecisionPayload({ ...emptyParams, comments: { '_global': 'note', other: 'x' } });
    expect(result.comments).toEqual({ other: 'x' });
  });

  test('reads globalComment from comments._global', () => {
    const result = buildDecisionPayload({ ...emptyParams, comments: { '_global': 'my note' } });
    expect(result.globalComment).toBe('my note');
  });

  test('globalComment is empty string when _global is absent', () => {
    const result = buildDecisionPayload(emptyParams);
    expect(result.globalComment).toBe('');
  });

  test('converts dismissedIds Set to array', () => {
    const result = buildDecisionPayload({ ...emptyParams, dismissedIds: new Set(['f001', 'f002']) });
    expect(result.dismissedIds).toEqual(['f001', 'f002']);
  });

  test('passes dismissReasons through unchanged', () => {
    const reasons = { f001: 'false positive' };
    const result = buildDecisionPayload({ ...emptyParams, dismissReasons: reasons });
    expect(result.dismissReasons).toBe(reasons);
  });

  test('_comment_ key with exactly the prefix produces empty-string finding id', () => {
    // slice(9) on '_comment_' (9 chars) yields '' — verify the function handles it without throwing
    const result = buildDecisionPayload({ ...emptyParams, comments: { '_comment_': 'edge' } });
    expect('' in result.comments).toBe(true);
    expect(result.comments['']).toBe('edge');
  });

  test('empty inputs produce empty outputs', () => {
    const result = buildDecisionPayload(emptyParams);
    expect(result.selectedIds).toEqual([]);
    expect(result.comments).toEqual({});
    expect(result.globalComment).toBe('');
    expect(result.dismissedIds).toEqual([]);
    expect(result.dismissReasons).toEqual({});
  });
});

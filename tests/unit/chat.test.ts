import { describe, test, expect } from 'bun:test';
import { createChatSession, chatSessions, buildChatSystemPrompt } from '../../packages/server/src/chat-sessions';
import type { ReviewData } from '@acr/shared';

describe('chat-sessions', () => {
  test('createChatSession registers session', () => {
    const id = createChatSession('claude-sonnet-4-6');
    expect(chatSessions.get(id)?.model).toBe('claude-sonnet-4-6');
    expect(chatSessions.get(id)?.firstQuery).toBe(true);
  });
  test('two sessions get different ids', () => {
    expect(createChatSession('m1')).not.toBe(createChatSession('m2'));
  });
  test('buildChatSystemPrompt has verdict + first 10 findings', () => {
    const rd: ReviewData = {
      verdict: 'V1', findings: Array.from({ length: 15 }, (_, i) => ({
        id: `f${i}`, severity: 'NOTE', file: 'a.ts', line: i, location: `a.ts:${i}`, finding: `F${i}`,
      })), files: [], summary: '', timestamp: '', branch: '', sessionId: 's',
    } as any;
    const out = buildChatSystemPrompt(rd, 'a.ts');
    expect(out).toContain('V1');
    expect(out).toContain('## Current File');
    expect(out).toContain('F0');
    expect(out).toContain('F9');
    expect(out).not.toContain('F10');
  });
});

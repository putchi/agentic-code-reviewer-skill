import { describe, test, expect, afterEach } from 'bun:test';
import { createChatSession, chatSessions, buildChatSystemPrompt } from '../../packages/server/src/chat-sessions';
import { handleChatQuery } from '../../packages/server/src/routes/chat';
import type { ReviewData } from '@acr/shared';

describe('chat-sessions', () => {
  afterEach(() => {
    delete process.env.ACR_REVIEW_PROVIDER;
    delete process.env.ACR_PLATFORM;
    delete process.env.ACR_DISABLE_CODEX_SDK;
    chatSessions.clear();
  });

  test('createChatSession registers session', () => {
    process.env.ACR_PLATFORM = 'claude';
    const id = createChatSession();
    expect(chatSessions.get(id)?.provider).toBe('claude');
    expect(chatSessions.get(id)?.model).toBe('sonnet');
    expect(chatSessions.get(id)?.firstQuerySent).toBe(false);
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

  test('buildChatSystemPrompt includes PR section for PR runs', () => {
    const rd: ReviewData = {
      verdict: 'V1', findings: [], files: [], summary: '', timestamp: '', branch: '', sessionId: 's',
      pr: { number: 42, title: 'Fix things', url: 'https://github.com/o/r/pull/42', headRefName: 'fix-things', baseRefName: 'main' },
    } as any;
    const out = buildChatSystemPrompt(rd);
    expect(out).toContain('## Pull Request');
    expect(out).toContain('PR #42');
    expect(out).toContain('git fetch origin fix-things');
    expect(out).toContain('may NOT match the PR head');
  });

  test('buildChatSystemPrompt omits PR section for local runs', () => {
    const rd: ReviewData = {
      verdict: 'V1', findings: [], files: [], summary: '', timestamp: '', branch: '', sessionId: 's',
    } as any;
    expect(buildChatSystemPrompt(rd)).not.toContain('## Pull Request');
  });

  test('createChatSession selects Codex provider from override', () => {
    process.env.ACR_REVIEW_PROVIDER = 'codex';
    const id = createChatSession();
    const session = chatSessions.get(id);
    expect(session?.provider).toBe('codex');
    expect(session?.model).toBe('gpt-5.4');
    expect(session?.codexReasoningEffort).toBe('medium');
  });

  test('Codex chat route reports unavailable SDK clearly', async () => {
    process.env.ACR_REVIEW_PROVIDER = 'codex';
    process.env.ACR_DISABLE_CODEX_SDK = '1';
    const id = createChatSession();
    const res = await handleChatQuery({ sessionId: id, prompt: 'hello' });
    const text = await res.text();
    expect(text).toContain('Codex Ask AI unavailable');
    expect(text).toContain('[DONE]');
  });
});

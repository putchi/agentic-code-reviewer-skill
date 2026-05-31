import { describe, expect, test } from 'bun:test';
import {
  buildRuntimeMetadata,
  resolveCodexReasoningForRole,
  resolveModelForRole,
  resolveReviewProvider,
  resolveRuntimePlatform,
} from '../../packages/server/src/runtime';

describe('runtime detection', () => {
  test('ACR_PLATFORM overrides session and install path detection', () => {
    expect(resolveRuntimePlatform({
      env: { ACR_PLATFORM: 'codex', CLAUDE_SESSION_ID: 's' },
      pluginRoot: '/Users/a/.claude/plugins/agentic-code-reviewer',
    })).toBe('codex');
  });

  test('--platform beats host session variables', () => {
    expect(resolveRuntimePlatform({
      explicitPlatform: 'claude',
      env: { CODEX_THREAD_ID: 't' },
      pluginRoot: '/Users/a/.codex/skills/agentic-code-reviewer',
    })).toBe('claude');
  });

  test('detects platform from host session and install path', () => {
    expect(resolveRuntimePlatform({ env: { CODEX_THREAD_ID: 't' }, pluginRoot: '' })).toBe('codex');
    expect(resolveRuntimePlatform({ env: {}, pluginRoot: '/Users/a/.codex/skills/agentic-code-reviewer' })).toBe('codex');
    expect(resolveRuntimePlatform({ env: {}, pluginRoot: '/Users/a/.claude/plugins/cache/agentic-code-reviewer' })).toBe('claude');
  });

  test('provider override wins over platform', () => {
    expect(resolveReviewProvider('claude', { ACR_REVIEW_PROVIDER: 'codex' })).toBe('codex');
  });
});

describe('runtime model mapping', () => {
  test('maps model roles for Claude and Codex', () => {
    expect(resolveModelForRole('claude', 'balanced', {})).toBe('sonnet');
    expect(resolveModelForRole('claude', 'fast', {})).toBe('haiku');
    expect(resolveModelForRole('claude', 'judge', {})).toBe('opus');
    expect(resolveModelForRole('codex', 'balanced', {})).toBe('gpt-5.4');
    expect(resolveModelForRole('codex', 'fast', {})).toBe('gpt-5.4-mini');
    expect(resolveModelForRole('codex', 'judge', {})).toBe('gpt-5.5');
  });

  test('supports model and reasoning overrides', () => {
    expect(resolveModelForRole('codex', 'judge', { ACR_MODEL_JUDGE: 'custom-judge' })).toBe('custom-judge');
    expect(resolveCodexReasoningForRole('judge', { ACR_CODEX_REASONING_JUDGE: 'xhigh' })).toBe('xhigh');
    expect(resolveCodexReasoningForRole('fast', {})).toBe('low');
  });

  test('builds UI runtime metadata', () => {
    const metadata = buildRuntimeMetadata({ explicitPlatform: 'codex', env: {}, pluginRoot: '', modelRole: 'balanced' });
    expect(metadata.provider).toBe('codex');
    expect(metadata.providerLabel).toBe('Codex');
    expect(metadata.chatModel).toBe('gpt-5.4');
    expect(metadata.chatModelLabel).toBe('GPT-5.4');
  });
});

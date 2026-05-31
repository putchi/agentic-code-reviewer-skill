import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function commandFor(role: string, env: Record<string, string>) {
  const result = spawnSync('bash', ['scripts/acr-runtime.sh', '--print-command', role, '/tmp/acr.raw.json'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  return result.stdout.split('\n').filter(Boolean);
}

describe('review subprocess command construction', () => {
  test('constructs Claude reviewer command', () => {
    const lines = commandFor('balanced', { ACR_REVIEW_PROVIDER: 'claude', ACR_CLAUDE_BIN: 'claude' });
    expect(lines).toContain('provider=claude');
    expect(lines).toContain('model=sonnet');
    expect(lines).toContain('claude');
    expect(lines).toContain('--print');
    expect(lines).toContain('--output-format');
    expect(lines).toContain('json');
    expect(lines).toContain('--model');
    expect(lines).toContain('sonnet');
  });

  test('constructs Codex reviewer command with model and reasoning', () => {
    const lines = commandFor('fast', { ACR_REVIEW_PROVIDER: 'codex', ACR_CODEX_BIN: 'codex' });
    expect(lines).toContain('provider=codex');
    expect(lines).toContain('model=gpt-5.4-mini');
    expect(lines).toContain('reasoning=low');
    expect(lines).toContain('codex');
    expect(lines).toContain('exec');
    expect(lines).toContain('--json');
    expect(lines).toContain('--model');
    expect(lines).toContain('gpt-5.4-mini');
    expect(lines).toContain('--config');
    expect(lines).toContain('model_reasoning_effort=low');
    expect(lines).toContain('--sandbox');
    expect(lines).toContain('read-only');
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('model output parser', () => {
  test('normalizes Codex JSONL agent_message output', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'acr-parser-'));
    try {
      const rawFile = resolve(dir, 'raw.jsonl');
      const outFile = resolve(dir, 'out.json');
      const finalMessage = JSON.stringify({
        run_id: 'r1',
        agent: 'semantic-analyzer',
        status: 'complete',
        findings: [{
          id: 'semantic-analyzer-1',
          severity: 'HIGH',
          file: 'src/a.ts',
          line: 7,
          finding: 'Bug',
          reasoning: 'Reason',
          evidence: 'code',
          confidence: 91,
        }],
      });
      writeFileSync(rawFile, [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: finalMessage.slice(0, 40) } }),
        JSON.stringify({ type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: finalMessage } }),
      ].join('\n'));

      const result = spawnSync('python3', [
        'scripts/claude_json.py',
        'reviewer',
        '--raw-file', rawFile,
        '--out-file', outFile,
        '--run-id', 'r1',
        '--agent', 'semantic-analyzer',
        '--started-at', '2026-05-31T00:00:00Z',
        '--completed-at', '2026-05-31T00:00:01Z',
      ], { cwd: process.cwd(), encoding: 'utf8' });

      expect(result.status).toBe(0);
      const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
      expect(parsed.status).toBe('complete');
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].finding).toBe('Bug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

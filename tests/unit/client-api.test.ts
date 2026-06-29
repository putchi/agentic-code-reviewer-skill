import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { postDecision } from '../../packages/client/src/lib/api';

const originalFetch = globalThis.fetch;

const payload = {
  runId: 'run-1',
  findingDecisions: {},
  globalComment: '',
  lineAnnotations: {},
};

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('postDecision', () => {
  test('returns response JSON on success', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(input).toBe('/api/implement');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      return Response.json({ ok: true, path: 'decisions.md' });
    }) as typeof fetch;

    await expect(postDecision('implement', payload)).resolves.toEqual({
      ok: true,
      path: 'decisions.md',
    });
  });

  test('throws server error message on HTTP failure', async () => {
    globalThis.fetch = (async () => Response.json(
      { error: 'failed to persist decisions' },
      { status: 500 },
    )) as typeof fetch;

    await expect(postDecision('done', payload)).rejects.toThrow('failed to persist decisions');
  });

  test('throws error JSON even when HTTP status is OK', async () => {
    globalThis.fetch = (async () => Response.json({ error: 'invalid decision payload' })) as typeof fetch;

    await expect(postDecision('save', payload)).rejects.toThrow('invalid decision payload');
  });

  test('throws clear message when local server is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    await expect(postDecision('implement', payload)).rejects.toThrow('Local review server is not reachable: Failed to fetch');
  });
});

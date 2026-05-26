import { describe, test, expect, beforeEach } from 'bun:test';

// Re-import fresh each test to reset module-level state
async function freshServeClient() {
  const mod = await import('../../packages/server/src/serve-client?t=' + Date.now());
  return mod.serveClient;
}

describe('serveClient', () => {
  test('returns 200 with correct Content-Type', async () => {
    const serveClient = await freshServeClient();
    const html = '<html><body>test</body></html>';
    const res = serveClient(html);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  test('returns the passed HTML string as body', async () => {
    const serveClient = await freshServeClient();
    const html = '<!doctype html><html><head><title>Agentic Code Review</title></head></html>';
    const res = serveClient(html);
    const body = await res.text();
    expect(body).toBe(html);
  });

  test('does not read from filesystem (no fs imports)', async () => {
    // Verify serve-client.ts source has no readFileSync or existsSync calls
    const src = await Bun.file(
      new URL('../../packages/server/src/serve-client.ts', import.meta.url)
    ).text();
    expect(src).not.toContain('readFileSync');
    expect(src).not.toContain('existsSync');
    expect(src).not.toContain('require(\'node:fs\')');
    expect(src).not.toContain('from \'node:fs\'');
  });
});

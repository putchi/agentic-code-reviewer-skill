import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const origFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = origFetch; });
afterEach(() => { globalThis.fetch = origFetch; });

describe('handleVersionCheck — fetchLatestVersion error paths', () => {
  test('returns empty latest when fetch throws', async () => {
    globalThis.fetch = async () => { throw new Error('network'); };
    const { handleVersionCheck } = await import('../../packages/server/src/routes/version');
    const data = await (await handleVersionCheck()).json() as Record<string, unknown>;
    expect(data.latest).toBe('');
    expect(data.updateAvailable).toBe(false);
  });

  test('returns empty latest when response is not ok', async () => {
    globalThis.fetch = async () => new Response('Service Unavailable', { status: 503 });
    const { handleVersionCheck } = await import('../../packages/server/src/routes/version');
    const data = await (await handleVersionCheck()).json() as Record<string, unknown>;
    expect(data.latest).toBe('');
    expect(data.updateAvailable).toBe(false);
  });

  test('returns empty latest when JSON has no plugins array', async () => {
    globalThis.fetch = async () => Response.json({ other: true });
    const { handleVersionCheck } = await import('../../packages/server/src/routes/version');
    const data = await (await handleVersionCheck()).json() as Record<string, unknown>;
    expect(data.latest).toBe('');
    expect(data.updateAvailable).toBe(false);
  });

  test('returns latest version from plugins array', async () => {
    globalThis.fetch = async () => Response.json({ plugins: [{ version: '9.9.9' }] });
    const { handleVersionCheck } = await import('../../packages/server/src/routes/version');
    const data = await (await handleVersionCheck()).json() as Record<string, unknown>;
    expect(data.latest).toBe('9.9.9');
  });
});

describe('handleVersionCheck — getInstalledVersion catch path', () => {
  test('returns empty installed when plugin.json is missing', async () => {
    const { PLUGIN_ROOT } = await import('../../packages/server/src/config');
    const pluginJson = resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
    const backup = pluginJson + '.bak';
    if (existsSync(pluginJson)) renameSync(pluginJson, backup);
    try {
      globalThis.fetch = async () => Response.json({ plugins: [] });
      const { handleVersionCheck } = await import('../../packages/server/src/routes/version');
      const data = await (await handleVersionCheck()).json() as Record<string, unknown>;
      expect(data.installed).toBe('');
      expect(data.updateAvailable).toBe(false);
    } finally {
      if (existsSync(backup)) renameSync(backup, pluginJson);
    }
  });
});

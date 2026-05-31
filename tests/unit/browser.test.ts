import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildBrowserCommand,
  isNoOpBrowserSentinel,
  openBrowser,
  tryVscodeIpc,
} from '../../packages/server/src/browser';

describe('browser opener', () => {
  test('ACR_BROWSER takes priority over BROWSER', () => {
    expect(buildBrowserCommand('http://127.0.0.1:1', {
      ACR_BROWSER: '/tmp/open-in-vscode',
      BROWSER: '/usr/bin/firefox',
    }, 'linux')).toEqual(['/tmp/open-in-vscode', 'http://127.0.0.1:1']);
  });

  test('BROWSER is used as a fallback', () => {
    expect(buildBrowserCommand('http://127.0.0.1:1', {
      BROWSER: '/usr/bin/firefox',
    }, 'linux')).toEqual(['/usr/bin/firefox', 'http://127.0.0.1:1']);
  });

  test('no-op browser sentinels are ignored', () => {
    expect(isNoOpBrowserSentinel('true')).toBe(true);
    expect(isNoOpBrowserSentinel('none')).toBe(true);
    expect(buildBrowserCommand('http://127.0.0.1:1', {
      ACR_BROWSER: 'true',
      BROWSER: 'none',
    }, 'linux')).toEqual(['xdg-open', 'http://127.0.0.1:1']);
  });

  test('VS Code IPC registry fallback opens matching workspace URL', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'acr-browser-test-'));
    const workspace = resolve(root, 'repo');
    const registryPath = resolve(root, 'vscode-ipc.json');
    let openedUrl = '';
    const server = createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      openedUrl = parsed.searchParams.get('url') || '';
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const port = (server.address() as { port: number }).port;
    writeFileSync(registryPath, JSON.stringify({ [workspace]: port }));

    try {
      const ok = await tryVscodeIpc('http://127.0.0.1:7788', {
        cwd: resolve(workspace, 'src'),
        registryPath,
      });
      expect(ok).toBe(true);
      expect(openedUrl).toBe('http://127.0.0.1:7788');
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('openBrowser uses IPC before system default when no real browser is configured', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'acr-browser-open-test-'));
    const workspace = resolve(root, 'repo');
    const registryPath = resolve(root, 'vscode-ipc.json');
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const port = (server.address() as { port: number }).port;
    writeFileSync(registryPath, JSON.stringify({ [workspace]: port }));
    let spawned = false;

    try {
      const ok = await openBrowser('http://127.0.0.1:7788', {
        env: { BROWSER: 'true' },
        cwd: workspace,
        registryPath,
        spawn: () => { spawned = true; },
      });
      expect(ok).toBe(true);
      expect(spawned).toBe(false);
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

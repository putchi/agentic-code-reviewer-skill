import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const NOOP_BROWSER_VALUES = new Set(['true', 'false', 'none', ':', '0', '1']);

export interface OpenBrowserOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  cwd?: string;
  registryPath?: string;
  fetchImpl?: typeof fetch;
  spawn?: (cmd: string[]) => void | Promise<void>;
}

export function isNoOpBrowserSentinel(value: string | undefined): boolean {
  if (!value) return false;
  return NOOP_BROWSER_VALUES.has(value.trim().toLowerCase());
}

function resolveAcrDataDir(env: Record<string, string | undefined> = process.env): string {
  const envDir = env.ACR_DATA_DIR?.trim();
  if (envDir) {
    if (envDir === '~') return homedir();
    if (envDir.startsWith('~/') || envDir.startsWith('~\\')) {
      return join(homedir(), envDir.slice(2));
    }
    return resolve(envDir);
  }
  return resolve(homedir(), '.claude', 'agentic-code-reviewer');
}

export function getVscodeIpcRegistryPath(env: Record<string, string | undefined> = process.env): string {
  return resolve(resolveAcrDataDir(env), 'vscode-ipc.json');
}

export async function tryVscodeIpc(
  url: string,
  options: Pick<OpenBrowserOptions, 'cwd' | 'registryPath' | 'fetchImpl'> = {},
): Promise<boolean> {
  try {
    const registryPath = options.registryPath || getVscodeIpcRegistryPath();
    if (!existsSync(registryPath)) return false;
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, number>;
    const cwd = resolve(options.cwd || process.cwd());
    let bestMatch = '';
    let bestPort = 0;
    for (const [workspace, port] of Object.entries(registry)) {
      const resolvedWorkspace = resolve(workspace);
      const isInsideWorkspace = cwd === resolvedWorkspace || cwd.startsWith(resolvedWorkspace + sep);
      if (isInsideWorkspace && resolvedWorkspace.length > bestMatch.length) {
        bestMatch = resolvedWorkspace;
        bestPort = port;
      }
    }
    if (!bestPort) return false;
    const ipcUrl = new URL('/open', `http://127.0.0.1:${bestPort}`);
    ipcUrl.searchParams.set('url', url);
    const fetcher = options.fetchImpl || fetch;
    const response = await fetcher(ipcUrl.toString());
    return response.ok;
  } catch {
    return false;
  }
}

export function buildBrowserCommand(
  url: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] | null {
  const acrBrowser = isNoOpBrowserSentinel(env.ACR_BROWSER) ? undefined : env.ACR_BROWSER;
  const browser = isNoOpBrowserSentinel(env.BROWSER) ? undefined : env.BROWSER;
  const configuredBrowser = acrBrowser || browser;
  if (configuredBrowser) {
    if (acrBrowser && platform === 'darwin' && (!acrBrowser.includes('/') || acrBrowser.endsWith('.app'))) {
      return ['open', '-a', acrBrowser, url];
    }
    return [configuredBrowser, url];
  }

  if (platform === 'darwin') return ['open', url];
  if (platform === 'win32') return ['cmd', '/c', 'start', '', url];
  return ['xdg-open', url];
}

function spawnCommand(cmd: string[]): void {
  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
  proc.unref?.();
}

export async function openBrowser(url: string, options: OpenBrowserOptions = {}): Promise<boolean> {
  const env = options.env || process.env;
  if (env.ACR_NO_OPEN === '1') return false;

  const acrBrowser = isNoOpBrowserSentinel(env.ACR_BROWSER) ? undefined : env.ACR_BROWSER;
  const browser = isNoOpBrowserSentinel(env.BROWSER) ? undefined : env.BROWSER;
  const hasConfiguredBrowser = Boolean(acrBrowser || browser);

  if (!hasConfiguredBrowser) {
    const openedViaIpc = await tryVscodeIpc(url, options);
    if (openedViaIpc) return true;
  }

  const cmd = buildBrowserCommand(url, env, options.platform || process.platform);
  if (!cmd) return false;

  try {
    await (options.spawn || spawnCommand)(cmd);
    return true;
  } catch {
    return tryVscodeIpc(url, options);
  }
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_ROOT, MARKETPLACE_URL, detectPlatform, buildInstallCommand } from '../config';

export function compareSemver(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
function getInstalledVersion(): string {
  try {
    const p = resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
    return JSON.parse(readFileSync(p, 'utf8')).version || '';
  } catch { return ''; }
}
async function fetchLatestVersion(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(MARKETPLACE_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return '';
    const json = await res.json() as { plugins?: Array<{ version?: string }> };
    return json.plugins?.[0]?.version || '';
  } catch { return ''; }
}
export async function handleVersionCheck(): Promise<Response> {
  const installed = getInstalledVersion();
  const latest = await fetchLatestVersion();
  const updateAvailable = !!(installed && latest && compareSemver(latest, installed) > 0);
  return Response.json({ installed, latest, updateAvailable,
    platform: detectPlatform(), installCommand: buildInstallCommand() });
}

import { resolve } from 'node:path';
function arg(name: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] ?? null : null;
}
export const sessionId = arg('--session') || 'unknown';
export const findingsFile = arg('--findings-file') || `/tmp/claude-code-review-${sessionId}.json`;
export const saveDir = arg('--save-dir') || resolve(process.cwd(), 'docs', 'code-reviews');
export const portArg = parseInt(arg('--port') || '0', 10);
export const decisionFile = `/tmp/claude-code-review-${sessionId}.decision`;
export const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
export const MARKETPLACE_URL = 'https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json';
export const INSTALL_BASE = 'curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash';
export function detectPlatform(): string {
  const explicit = arg('--platform');
  if (explicit) return explicit;
  if (PLUGIN_ROOT.includes('/.claude/plugins/')) return 'claude';
  if (PLUGIN_ROOT.includes('/.codex/skills/')) return 'codex';
  return '';
}
export function buildInstallCommand(): string {
  const p = detectPlatform();
  return p ? `${INSTALL_BASE} -s -- --platform ${p}` : INSTALL_BASE;
}

import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveRuntimePlatform } from './runtime';
function arg(name: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] ?? null : null;
}

function resolvePluginRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  const localRepo = resolve(process.cwd(), '.claude-plugin', 'plugin.json');
  if (existsSync(localRepo)) return process.cwd();
  const claudeCache = resolve(home, '.claude/plugins/cache/agentic-code-reviewer');
  if (existsSync(claudeCache)) return claudeCache;
  const claudeMarketplace = resolve(home, '.claude/plugins/marketplaces/agentic-code-reviewer-skill');
  if (existsSync(claudeMarketplace)) return claudeMarketplace;
  const codexSkill = resolve(home, '.codex/skills/agentic-code-reviewer');
  if (existsSync(codexSkill)) return codexSkill;
  // Fallback: create a persistent settings dir in ~/.claude/agentic-code-reviewer/
  const fallback = resolve(home, '.claude/agentic-code-reviewer');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

export const sessionId = arg('--session') || 'unknown';
export const runDir = arg('--run-dir') ? resolve(arg('--run-dir')!) : null;
export const findingsFile = arg('--findings-file') || `/tmp/claude-code-review-${sessionId}.json`;
export const saveDir = arg('--save-dir') || resolve(process.cwd(), 'docs', 'code-reviews');
export const portArg = parseInt(arg('--port') || '0', 10);
export const decisionFile = `/tmp/claude-code-review-${sessionId}.decision`;
export const decisionsJsonFile = runDir ? resolve(runDir, 'decisions.json') : null;
export const synthesisFile = runDir ? resolve(runDir, 'synthesis.json') : null;
export const contextFile = runDir ? resolve(runDir, 'context.json') : null;
export const diffFile = runDir ? resolve(runDir, 'diff.txt') : null;
export const runJsonFile = runDir ? resolve(runDir, 'run.json') : null;
export const doneFile = `/tmp/claude-code-review-${sessionId}.done`;
export const PLUGIN_ROOT = resolvePluginRoot();
export const MARKETPLACE_URL = 'https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/.claude-plugin/marketplace.json';
export const INSTALL_BASE = 'curl -fsSL https://raw.githubusercontent.com/putchi/agentic-code-reviewer-skill/main/install.sh | bash';
export function detectPlatform(): string {
  return resolveRuntimePlatform({ explicitPlatform: arg('--platform'), pluginRoot: PLUGIN_ROOT });
}
export function buildInstallCommand(): string {
  const p = detectPlatform();
  return p ? `${INSTALL_BASE} -s -- --platform ${p}` : INSTALL_BASE;
}

// Allow overriding the save dir via query param for dev convenience
export function resolveSaveDirFromRequest(reqUrl: string): string {
  const url = new URL(reqUrl, 'http://localhost');
  const override = url.searchParams.get('saveDir');
  return override ? resolve(override) : saveDir;
}

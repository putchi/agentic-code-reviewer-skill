import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PLUGIN_ROOT, runDir, runJsonFile, sessionId } from './config';
import { resolveCLIPath, resolveCodexCLIPath } from './cli-path';

interface AutoResumeResult {
  started: boolean;
  reason?: string;
  host?: 'claude' | 'codex';
  pid?: number;
  fallbackCommand?: string;
}

function readRunMeta(): { repo: string; runId: string } {
  const fallback = { repo: process.cwd(), runId: sessionId };
  if (!runJsonFile || !existsSync(runJsonFile)) return fallback;
  try {
    const data = JSON.parse(readFileSync(runJsonFile, 'utf8')) as Record<string, unknown>;
    return {
      repo: typeof data.repo === 'string' && data.repo ? data.repo : fallback.repo,
      runId: typeof data.run_id === 'string' && data.run_id ? data.run_id : fallback.runId,
    };
  } catch {
    return fallback;
  }
}

// Shell-safe single quoting for command strings embedded in agent prompts —
// these are agent-executed text, so quote defensively like decisions.ts does.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildPrompt(repo: string, reviewRunId: string): string {
  const resumeScript = resolve(PLUGIN_ROOT, 'scripts', 'review-resume.sh');
  return [
    'The Agentic Code Reviewer UI was closed after the user saved final decisions.',
    'Resume immediately from those decisions and complete the requested work.',
    '',
    'First run this command and read its output:',
    `bash ${shellQuote(resumeScript)} --repo ${shellQuote(repo)} --run-id ${shellQuote(reviewRunId)}`,
    '',
    'Then follow the printed instructions exactly.',
    'Implement only findings marked for implementation or accepted fix.',
    'Do not implement ignored/dismissed findings.',
    'If no findings are selected for implementation, report that no code changes were requested.',
  ].join('\n');
}

function buildFallbackCommand(repo: string, reviewRunId: string): string {
  const resumeScript = resolve(PLUGIN_ROOT, 'scripts', 'review-resume.sh');
  return `bash ${shellQuote(resumeScript)} --repo ${shellQuote(repo)} --run-id ${shellQuote(reviewRunId)}`;
}

function writeAutoResumeState(result: AutoResumeResult) {
  if (!runDir) return;
  try {
    writeFileSync(
      resolve(runDir, 'auto-resume.json'),
      JSON.stringify({ ...result, triggered_at: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {}
}

export async function triggerAutoResume(): Promise<AutoResumeResult> {
  const { repo, runId: reviewRunId } = readRunMeta();
  const fallbackCommand = buildFallbackCommand(repo, reviewRunId);

  if (process.env.ACR_DISABLE_AUTO_RESUME === '1') {
    const result = { started: false, reason: 'disabled', fallbackCommand };
    writeAutoResumeState(result);
    return result;
  }
  if (!runDir) {
    const result = { started: false, reason: 'no run directory', fallbackCommand };
    writeAutoResumeState(result);
    return result;
  }

  const prompt = buildPrompt(repo, reviewRunId);
  const logPath = resolve(runDir, 'auto-resume.log');
  let host: 'claude' | 'codex' | null = null;
  let command = '';
  let args: string[] = [];

  if (process.env.CLAUDE_SESSION_ID) {
    host = 'claude';
    const resolved = await resolveCLIPath();
    if (!resolved) {
      const result = { started: false, host, reason: 'claude executable not found', fallbackCommand };
      writeAutoResumeState(result);
      return result;
    }
    command = resolved;
    args = ['--resume', process.env.CLAUDE_SESSION_ID, '--print', '--output-format', 'text', prompt];
  } else if (process.env.CODEX_THREAD_ID) {
    host = 'codex';
    const resolved = resolveCodexCLIPath();
    if (!resolved) {
      const result = { started: false, host, reason: 'codex executable not found', fallbackCommand };
      writeAutoResumeState(result);
      return result;
    }
    command = resolved;
    args = ['exec', 'resume', process.env.CODEX_THREAD_ID, prompt];
  }

  if (!host || !command) {
    const result = { started: false, reason: 'no Claude or Codex session id in environment', fallbackCommand };
    writeAutoResumeState(result);
    return result;
  }

  let logFd: number | null = null;
  try {
    logFd = openSync(logPath, 'a');
    const child = spawn(command, args, {
      cwd: repo,
      detached: true,
      env: {
        ...process.env,
        ACR_AUTO_RESUME: '1',
        ACR_REVIEW_SUBPROCESS: '1',
      },
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    const result = { started: true, host, pid: child.pid, fallbackCommand };
    writeAutoResumeState(result);
    return result;
  } catch (error: any) {
    const result = { started: false, host, reason: error?.message || 'spawn failed', fallbackCommand };
    writeAutoResumeState(result);
    return result;
  } finally {
    if (logFd !== null) {
      try { closeSync(logFd); } catch {}
    }
  }
}

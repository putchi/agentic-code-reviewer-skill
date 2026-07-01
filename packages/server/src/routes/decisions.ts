import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DecisionPayload, DecisionsFile, FindingDecision, RunContext, SynthesisFinding } from '@acr/shared';
import { FINDING_ACTIONS } from '@acr/shared';
import { writeFileAtomic } from '../fs-atomic';
import { decisionFile, decisionsJsonFile, doneFile, runJsonFile, contextFile, runDir, PLUGIN_ROOT, sessionId } from '../config';
import { readFindings, saveMarkdown } from '../findings';
import { triggerAutoResume } from '../auto-resume';

const FINAL_SHUTDOWN_DELAY_MS = 10_000;

// f4: shell-safe quoting — consistent with how review-gate.py uses shlex.quote
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function scheduleFinalShutdown(): void {
  setTimeout(() => process.exit(0), FINAL_SHUTDOWN_DELAY_MS);
}

export function validateDecisionPayload(payload: DecisionPayload): string | null {
  if (!payload || typeof payload !== 'object') return 'payload must be a JSON object';
  if (payload.findingDecisions) {
    if (typeof payload.findingDecisions !== 'object' || Array.isArray(payload.findingDecisions)) {
      return 'findingDecisions must be an object';
    }
    for (const [id, dec] of Object.entries(payload.findingDecisions)) {
      const action = (dec as FindingDecision | null)?.action;
      if (!action || !(FINDING_ACTIONS as readonly string[]).includes(action)) {
        return `invalid action ${JSON.stringify(action)} for finding ${JSON.stringify(id)}`;
      }
    }
  }
  return null;
}

function normalizeDecision(payload: DecisionPayload, fallbackAction: 'implement' | 'save' | 'done'): DecisionsFile {
  const review = readFindings();
  const findings: Record<string, FindingDecision> = {};
  if (payload.findingDecisions) {
    Object.assign(findings, payload.findingDecisions);
  } else {
    for (const id of payload.selectedIds || []) {
      findings[id] = { action: fallbackAction === 'implement' ? 'ask_claude_to_implement' : 'accept_fix', comment: payload.comments?.[id] };
    }
    for (const id of payload.dismissedIds || []) {
      findings[id] = { action: 'ignore', comment: payload.dismissReasons?.[id] || payload.comments?.[id] };
    }
  }
  return {
    run_id: payload.runId || review.runId || review.sessionId || 'unknown',
    decided_at: new Date().toISOString(),
    global_comment: payload.globalComment || '',
    findings,
    line_annotations: payload.lineAnnotations || {},
  };
}

function updateRunStatus(status: string) {
  if (!runJsonFile || !existsSync(runJsonFile)) return;
  try {
    const run = JSON.parse(readFileSync(runJsonFile, 'utf8'));
    run.status = status;
    run.decided_at = new Date().toISOString();
    writeFileAtomic(runJsonFile, JSON.stringify(run, null, 2));
  } catch {}
}

function writeResumeArtifact(decision: DecisionsFile): void {
  if (!decisionsJsonFile || !runDir) return;
  try {
    const review = readFindings();
    const contextJson = contextFile && existsSync(contextFile)
      ? JSON.parse(readFileSync(contextFile, 'utf8')) as RunContext
      : null;
    const repo = contextJson?.repo || '';
    const runId = decision.run_id;

    const findingsByAction: Record<string, Array<SynthesisFinding & { comment?: string }>> = {
      ask_claude_to_implement: [],
      accept_fix: [],
      ask_claude_to_explain: [],
      create_follow_up_task: [],
      ignore: [],
    };

    const findingMap = new Map<string, SynthesisFinding>(
      (review.findings || []).map(f => [f.id, f as SynthesisFinding])
    );

    for (const [id, dec] of Object.entries(decision.findings)) {
      const finding = findingMap.get(id);
      const bucket = findingsByAction[dec.action];
      if (bucket) {
        // f6: explicit fallback with required fields instead of unsound cast
        const fallback: SynthesisFinding = { id, severity: 'HIGH', file: '', line: 0, location: '', finding: '', source_agents: [] };
        bucket.push({ ...(finding ?? fallback), comment: dec.comment });
      }
    }

    // f4: quote each path component — mirrors review-gate.py's use of shlex.quote
    const scriptPath = resolve(PLUGIN_ROOT, 'scripts', 'review-resume.sh');
    const resumeCommand = `bash ${shellQuote(scriptPath)} --repo ${shellQuote(repo)} --run-id ${shellQuote(runId)}`;

    const artifact = {
      run_id: runId,
      repo,
      decided_at: decision.decided_at,
      findings_by_action: findingsByAction,
      global_comment: decision.global_comment,
      line_annotations: decision.line_annotations,
      resume_command: resumeCommand,
    };

    const artifactPath = resolve(runDir, 'resume-artifact.json');
    writeFileAtomic(artifactPath, JSON.stringify(artifact, null, 2));
  } catch (e) {
    // f8: log warning so operators see when the fast-path artifact is unavailable
    process.stderr.write(`[acr] Warning: failed to write resume-artifact.json: ${e}\n`);
  }
}

export function buildDoneSentinel(decision: DecisionsFile, context: RunContext | null): Record<string, string> {
  return {
    repo: context?.repo || '',
    session_id: sessionId,
    run_id: decision.run_id,
    diff_sha256: typeof context?.diff_sha256 === 'string' ? context.diff_sha256 : '',
    reason: 'server_final_decision',
    handled_at: new Date().toISOString(),
  };
}

function writeDoneSentinel(decision: DecisionsFile): void {
  const contextJson = contextFile && existsSync(contextFile)
    ? JSON.parse(readFileSync(contextFile, 'utf8')) as RunContext
    : null;
  writeFileAtomic(doneFile, JSON.stringify(buildDoneSentinel(decision, contextJson), null, 2));
}

function persistDecision(payload: DecisionPayload, action: 'implement' | 'save' | 'done'): DecisionsFile {
  const decision = normalizeDecision(payload, action);
  if (decisionsJsonFile) {
    writeFileAtomic(decisionsJsonFile, JSON.stringify(decision, null, 2));
    updateRunStatus(action === 'save' ? 'decisions_saved' : 'decisions_ready');
    // f2: resume artifact is only valid for final decisions; skip for intermediate saves
    if (action !== 'save') writeResumeArtifact(decision);
  }
  writeFileAtomic(decisionFile, JSON.stringify({ action, ...payload, decisions: decision }));
  if (action !== 'save') writeDoneSentinel(decision);
  return decision;
}

export async function handleImplement(payload: DecisionPayload): Promise<Response> {
  const invalid = validateDecisionPayload(payload);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  try {
    const decision = persistDecision(payload, 'implement');
    try {
      const rd: any = readFindings(); rd._decision = decision;
      saveMarkdown(rd, payload.lineAnnotations || {});
    } catch {}
    const autoResume = await triggerAutoResume();
    scheduleFinalShutdown();
    return Response.json({ ok: true, autoResume });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleSave(payload: DecisionPayload): Promise<Response> {
  const invalid = validateDecisionPayload(payload);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  try {
    const decision = persistDecision(payload, 'save');
    const rd: any = readFindings(); rd._decision = decision;
    const savedPath = saveMarkdown(rd, payload.lineAnnotations || {});
    return Response.json({ ok: true, path: savedPath });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleDone(payload: DecisionPayload): Promise<Response> {
  const invalid = validateDecisionPayload(payload);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  try {
    const decision = persistDecision(payload, 'done');
    try {
      const rd: any = readFindings(); rd._decision = decision;
      saveMarkdown(rd, payload.lineAnnotations || {});
    } catch {}
    const autoResume = await triggerAutoResume();
    scheduleFinalShutdown();
    return Response.json({ ok: true, autoResume });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

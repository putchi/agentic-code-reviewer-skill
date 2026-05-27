import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { DecisionPayload, DecisionsFile, FindingDecision } from '@acr/shared';
import { decisionFile, decisionsJsonFile, doneFile, runJsonFile } from '../config';
import { readFindings, saveMarkdown } from '../findings';

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
    writeFileSync(runJsonFile, JSON.stringify(run, null, 2), 'utf8');
  } catch {}
}

function persistDecision(payload: DecisionPayload, action: 'implement' | 'save' | 'done'): DecisionsFile {
  const decision = normalizeDecision(payload, action);
  if (decisionsJsonFile) {
    writeFileSync(decisionsJsonFile, JSON.stringify(decision, null, 2), 'utf8');
    updateRunStatus('decisions_ready');
  }
  writeFileSync(decisionFile, JSON.stringify({ action, ...payload, decisions: decision }), 'utf8');
  writeFileSync(doneFile, '', 'utf8');
  return decision;
}

export async function handleImplement(payload: DecisionPayload): Promise<Response> {
  try {
    const decision = persistDecision(payload, 'implement');
    try {
      const rd: any = readFindings(); rd._decision = decision;
      saveMarkdown(rd, payload.lineAnnotations || {});
    } catch {}
    setTimeout(() => process.exit(0), 500);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleSave(payload: DecisionPayload): Promise<Response> {
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
  try {
    const decision = persistDecision(payload, 'done');
    try {
      const rd: any = readFindings(); rd._decision = decision;
      saveMarkdown(rd, payload.lineAnnotations || {});
    } catch {}
    setTimeout(() => process.exit(0), 300);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

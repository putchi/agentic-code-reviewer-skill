import { writeFileSync } from 'node:fs';
import type { DecisionPayload } from '@acr/shared';
import { decisionFile, doneFile } from '../config';
import { readFindings, saveMarkdown } from '../findings';

export async function handleImplement(payload: DecisionPayload): Promise<Response> {
  try {
    writeFileSync(decisionFile, JSON.stringify({ action: 'implement', ...payload }), 'utf8');
    writeFileSync(doneFile, '', 'utf8');
    try {
      const rd: any = readFindings(); rd._decision = payload;
      saveMarkdown(rd, payload.lineAnnotations);
    } catch {}
    setTimeout(() => process.exit(0), 500);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleSave(payload: DecisionPayload): Promise<Response> {
  try {
    const rd: any = readFindings(); rd._decision = payload;
    const savedPath = saveMarkdown(rd, payload.lineAnnotations);
    writeFileSync(decisionFile, JSON.stringify({ action: 'save', ...payload }), 'utf8');
    writeFileSync(doneFile, '', 'utf8');
    return Response.json({ ok: true, path: savedPath });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
export async function handleDone(payload: DecisionPayload): Promise<Response> {
  writeFileSync(decisionFile, JSON.stringify({ action: 'done', ...payload }), 'utf8');
  writeFileSync(doneFile, '', 'utf8');
  setTimeout(() => process.exit(0), 300);
  return Response.json({ ok: true });
}

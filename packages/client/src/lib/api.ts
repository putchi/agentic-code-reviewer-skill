import type { ReviewData, DecisionPayload, LineAnnotation } from '@acr/shared';
export interface Settings { autoCloseMs: number; chatModel: string; firstRunDone: boolean; }

export interface BuildPayloadParams {
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  dismissedIds: Set<string>;
  dismissReasons: Record<string, string>;
}

export function buildDecisionPayload(params: BuildPayloadParams): Omit<DecisionPayload, 'action'> {
  const { checkedIds, comments, globalComment, lineAnnotations, dismissedIds, dismissReasons } = params;
  const selectedIds = Array.from(checkedIds);
  const commentMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(comments)) {
    if (k.startsWith('_comment_') && v) commentMap[k.slice(9)] = v;
  }
  return {
    selectedIds,
    comments: commentMap,
    globalComment: comments['_global'] || globalComment,
    lineAnnotations,
    dismissedIds: Array.from(dismissedIds),
    dismissReasons,
  };
}

export async function fetchSettings(): Promise<Settings> { return (await fetch('/api/settings')).json(); }
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  return (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json();
}
export async function fetchReview(): Promise<ReviewData> { return (await fetch('/api/review')).json(); }
export async function fetchVersionCheck() { return (await fetch('/api/version-check')).json(); }
export async function postDecision(action: 'implement'|'save'|'done', payload: Omit<DecisionPayload,'action'>) {
  const res = await fetch(`/api/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  return res.json();
}
export async function createChatSession(model: string): Promise<string> {
  const res = await fetch('/api/chat/session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model }) });
  return (await res.json()).sessionId;
}
export async function abortChat(sessionId: string) {
  await fetch('/api/chat/abort', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId }) });
}

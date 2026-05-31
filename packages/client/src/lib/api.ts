import type { ReviewData, DecisionPayload } from '@acr/shared';
export interface Settings {
  autoCloseMs: number;
  firstRunDone: boolean;
  platform: string;
  provider: 'claude' | 'codex';
  providerLabel: string;
  chatModel: string;
  chatModelLabel: string;
  modelRole: 'balanced' | 'fast' | 'judge';
}

export async function fetchSettings(): Promise<Settings> { return (await fetch('/api/settings')).json(); }
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  return (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json();
}
export async function resetSettings(): Promise<Settings> {
  return (await fetch('/api/settings/reset', { method: 'POST' })).json();
}
export async function fetchReview(): Promise<ReviewData> { return (await fetch('/api/review')).json(); }
export async function fetchVersionCheck() { return (await fetch('/api/version-check')).json(); }
export async function postDecision(action: 'implement'|'save'|'done', payload: Omit<DecisionPayload,'action'>) {
  const res = await fetch(`/api/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  return res.json();
}
export async function createChatSession(): Promise<string> {
  const res = await fetch('/api/chat/session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
  return (await res.json()).sessionId;
}
export async function abortChat(sessionId: string) {
  await fetch('/api/chat/abort', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId }) });
}

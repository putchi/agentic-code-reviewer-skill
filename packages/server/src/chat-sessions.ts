import type { ReviewData } from '@acr/shared';
import { buildChatSystemPrompt } from './chat-context';
export { buildChatSystemPrompt };

export interface ChatSession {
  id: string;
  model: string;
  systemPrompt: string;
  resolvedSessionId: string | null;
  firstQuerySent: boolean;
  abortController: AbortController | null;
}

export const chatSessions = new Map<string, ChatSession>();
let counter = 0;

export function createChatSession(model: string, reviewData?: ReviewData, currentFile?: string): string {
  const id = 'chat-' + (++counter) + '-' + Date.now();
  chatSessions.set(id, {
    id,
    model: model || 'claude-sonnet-4-6',
    systemPrompt: reviewData ? buildChatSystemPrompt(reviewData, currentFile) : '',
    resolvedSessionId: null,
    firstQuerySent: false,
    abortController: null,
  });
  return id;
}

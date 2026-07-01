import type { ReviewData } from '@acr/shared';
import { buildChatSystemPrompt } from './chat-context';
import { PLUGIN_ROOT, detectPlatform } from './config';
import { buildRuntimeMetadata, resolveCodexReasoningForRole, type CodexReasoningEffort, type ReviewProvider, type ModelRole } from './runtime';
export { buildChatSystemPrompt };

export interface ChatSession {
  id: string;
  model: string;
  modelRole: ModelRole;
  modelLabel: string;
  provider: ReviewProvider;
  providerLabel: string;
  codexReasoningEffort?: CodexReasoningEffort;
  systemPrompt: string;
  resolvedSessionId: string | null;
  firstQuerySent: boolean;
  abortController: AbortController | null;
  providerState?: Record<string, unknown>;
}

export const chatSessions = new Map<string, ChatSession>();
let counter = 0;

// ponytail: simple FIFO cap; a single-user local server never needs real LRU
const MAX_CHAT_SESSIONS = 20;
function evictOldSessions(): void {
  while (chatSessions.size > MAX_CHAT_SESSIONS) {
    const oldest = chatSessions.keys().next().value;
    if (oldest === undefined) break;
    chatSessions.get(oldest)?.abortController?.abort();
    chatSessions.delete(oldest);
  }
}

export function resolveChatRuntime() {
  const metadata = buildRuntimeMetadata({ explicitPlatform: detectPlatform(), pluginRoot: PLUGIN_ROOT, modelRole: 'balanced' });
  return {
    ...metadata,
    codexReasoningEffort: metadata.provider === 'codex' ? resolveCodexReasoningForRole('balanced') : undefined,
  };
}

export function createChatSession(_model?: string, reviewData?: ReviewData, currentFile?: string): string {
  const runtime = resolveChatRuntime();
  const id = 'chat-' + (++counter) + '-' + Date.now();
  chatSessions.set(id, {
    id,
    model: runtime.chatModel,
    modelRole: runtime.modelRole,
    modelLabel: runtime.chatModelLabel,
    provider: runtime.provider,
    providerLabel: runtime.providerLabel,
    codexReasoningEffort: runtime.codexReasoningEffort,
    systemPrompt: reviewData ? buildChatSystemPrompt(reviewData, currentFile) : '',
    resolvedSessionId: null,
    firstQuerySent: false,
    abortController: null,
    providerState: {},
  });
  evictOldSessions();
  return id;
}

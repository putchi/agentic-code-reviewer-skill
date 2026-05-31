export interface ChatSessionInfo {
  id: string;
  model: string;
  provider?: 'claude' | 'codex';
  providerLabel?: string;
  modelLabel?: string;
  firstQuery: boolean;
}
export interface SSETextDelta { type: 'text_delta'; delta: string; }
export interface SSEError { type: 'error'; message: string; }
export type SSEEvent = SSETextDelta | SSEError;

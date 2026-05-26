export interface ChatSessionInfo { id: string; model: string; firstQuery: boolean; }
export interface SSETextDelta { type: 'text_delta'; delta: string; }
export interface SSEError { type: 'error'; message: string; }
export type SSEEvent = SSETextDelta | SSEError;

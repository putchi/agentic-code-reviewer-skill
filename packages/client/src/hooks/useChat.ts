import { useRef, useState } from 'react';
import { createChatSession, abortChat } from '../lib/api';
import { readChatEventStream } from '../lib/chatStream';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  streaming?: boolean;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const idCounter = useRef(0);

  function clearMessageStreaming() {
    setMessages(prev => prev.map(m =>
      m.streaming ? { ...m, streaming: false } : m
    ));
  }

  async function send(prompt: string, currentFile?: string) {
    if (streaming) return;
    if (!sessionRef.current) {
      sessionRef.current = await createChatSession();
    }

    const userId = ++idCounter.current;
    const assistantId = ++idCounter.current;

    // Add user message immediately; defer assistant message until first text arrives
    // to avoid referencing assistantId before React state settles.
    setMessages(prev => [
      ...prev,
      { id: userId, role: 'user', text: prompt },
    ]);
    setStreaming(true);

    let assistantInserted = false;

    try {
      const res = await fetch('/api/chat/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current, prompt, currentFile }),
      });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      readerRef.current = reader;

      await readChatEventStream(reader, evt => {
        if (evt.type === 'text_delta' && typeof evt.delta === 'string') {
          if (!assistantInserted) {
            assistantInserted = true;
            setMessages(prev => [
              ...prev,
              { id: assistantId, role: 'assistant', text: evt.delta, streaming: true },
            ]);
          } else {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, text: m.text + evt.delta } : m
            ));
          }
        } else if (evt.type === 'error') {
          const message = typeof evt.message === 'string' ? evt.message : 'Unknown error';
          if (!assistantInserted) {
            assistantInserted = true;
            setMessages(prev => [
              ...prev,
              { id: assistantId, role: 'assistant', text: `Error: ${message}`, streaming: true },
            ]);
          } else {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, text: `Error: ${message}` } : m
            ));
          }
        }
      });
    } catch (e: any) {
      if (!assistantInserted) {
        assistantInserted = true;
        setMessages(prev => [
          ...prev,
          { id: assistantId, role: 'assistant', text: `Error: ${e.message}`, streaming: true },
        ]);
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, text: `Error: ${e.message}` } : m
        ));
      }
    } finally {
      // Ensure assistant message exists (e.g. empty response) to avoid dangling spinner
      if (!assistantInserted) {
        setMessages(prev => [
          ...prev,
          { id: assistantId, role: 'assistant', text: '', streaming: false },
        ]);
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, streaming: false } : m
        ));
      }
      readerRef.current = null;
      setStreaming(false);
    }
  }

  async function abort() {
    const reader = readerRef.current;
    if (reader) { try { await reader.cancel(); } catch {} }
    readerRef.current = null;
    try {
      if (sessionRef.current) await abortChat(sessionRef.current);
    } finally {
      clearMessageStreaming();
      setStreaming(false);
    }
  }

  return { messages, streaming, send, abort };
}

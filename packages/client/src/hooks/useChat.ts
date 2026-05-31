import { useRef, useState } from 'react';
import { createChatSession, abortChat } from '../lib/api';

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
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const evt = JSON.parse(data);
            if (evt.type === 'text_delta') {
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
              if (!assistantInserted) {
                assistantInserted = true;
                setMessages(prev => [
                  ...prev,
                  { id: assistantId, role: 'assistant', text: `Error: ${evt.message}`, streaming: true },
                ]);
              } else {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, text: `Error: ${evt.message}` } : m
                ));
              }
            }
          } catch {}
        }
      }
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
    if (readerRef.current) { try { readerRef.current.cancel(); } catch {} }
    if (sessionRef.current) await abortChat(sessionRef.current);
    setStreaming(false);
  }

  return { messages, streaming, send, abort };
}

import { useRef, useState } from 'react';
import { createChatSession, abortChat } from '../lib/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

export function useChat(model: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  async function send(prompt: string, currentFile?: string) {
    if (streaming) return;
    if (!sessionRef.current) {
      sessionRef.current = await createChatSession(model);
    }
    setMessages(prev => [...prev, { role: 'user', text: prompt }]);
    setStreaming(true);

    let assistantIdx: number;
    setMessages(prev => {
      assistantIdx = prev.length;
      return [...prev, { role: 'assistant', text: '', streaming: true }];
    });

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
              setMessages(prev => prev.map((m, i) =>
                i === assistantIdx ? { ...m, text: m.text + evt.delta } : m
              ));
            } else if (evt.type === 'error') {
              setMessages(prev => prev.map((m, i) =>
                i === assistantIdx ? { ...m, text: `Error: ${evt.message}` } : m
              ));
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx! ? { ...m, text: `Error: ${e.message}` } : m
      ));
    } finally {
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx! ? { ...m, streaming: false } : m
      ));
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

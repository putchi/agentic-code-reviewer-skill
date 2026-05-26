import { useRef, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { useChat } from '../../hooks/useChat';

interface Props {
  model: string;
  currentFile?: string;
  prefillPrompt?: string;
  onPrefillConsumed?: () => void;
}

export default function ChatPanel({ model, currentFile, prefillPrompt, onPrefillConsumed }: Props) {
  const { messages, streaming, send, abort } = useChat(model);
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (prefillPrompt) {
      setInput(prefillPrompt);
      taRef.current?.focus();
      onPrefillConsumed?.();
    }
  }, [prefillPrompt]);

  function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    send(text, currentFile);
  }

  return (
    <div className="chat-section">
      <div className="chat-header">
        ✨ Chat <span className="chat-model-label">· {model.split('-').slice(-2).join(' ')}</span>
        {streaming && <button onClick={abort} style={{ marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>■ Stop</button>}
      </div>
      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && <div className="chat-empty">Ask Claude about this diff…</div>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-q' : `chat-a${m.streaming ? ' chat-cursor' : ''}`}>
            {m.text || (m.streaming ? '' : '(empty)')}
          </div>
        ))}
      </div>
      <div className="chat-input-area">
        <textarea ref={taRef} className="chat-textarea" rows={2}
          placeholder="Ask about this diff…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
        <button className="btn btn-sm chat-send" onClick={handleSend} disabled={streaming || !input.trim()}>
          <FontAwesomeIcon icon={faPaperPlane} />
        </button>
      </div>
    </div>
  );
}

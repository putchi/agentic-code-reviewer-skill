import { useRef, useEffect, useState } from 'react';
import { useChat } from '../../hooks/useChat';

interface Props {
  providerLabel: string;
  chatModelLabel: string;
  currentFile?: string;
  prefillTrigger?: { id: number; prompt: string } | null;
}

export default function ChatPanel({ providerLabel, chatModelLabel, currentFile, prefillTrigger }: Props) {
  const { messages, streaming, send, abort } = useChat();
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isBusy = streaming;

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (prefillTrigger?.prompt) {
      handleSend(prefillTrigger.prompt);
    }
  }, [prefillTrigger?.id]);

  function handleSend(text?: string) {
    const msg = (text ?? draft).trim();
    if (!msg || isBusy) return;
    if (!text) setDraft('');
    send(msg, currentFile);
  }

  return (
    <div className="chat">
      <div className="chat__thread" ref={threadRef}>
        {messages.length === 0 && (
          <div style={{ padding: '8px 4px 0', color: 'var(--fg-faint)', fontSize: 12.5 }}>
            <div style={{ color: 'var(--fg-default)', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              Ask AI about this review
            </div>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              Ask about a specific finding, the diff, or the verdict.
            </p>
          </div>
        )}
        {messages.map(m => {
          const role = m.role === 'assistant' ? 'ai' : m.role === 'error' ? 'error' : 'user';
          return (
            <div key={m.id} className={`chat__msg chat__msg--${role}${role === 'error' ? ' chat__msg--err' : ''}`}>
              <div className="chat__bubble">
                <div className="chat__role">
                  {role === 'ai' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 3l1.5 5H18l-4.5 3.5L15 17l-3-2.5L9 17l1.5-5.5L6 8h4.5z"/>
                    </svg>
                  )}
                  {role === 'error' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  )}
                  {role === 'user' ? 'You' : role === 'ai' ? providerLabel : 'Chat error'}
                </div>
                <div className={`chat__text${m.streaming ? ' chat__streaming' : ''}`}>
                  {m.text || (m.streaming ? '' : '(empty)')}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {messages.length === 0 && (
        <div className="chat__suggestions">
          {['Summarize the critical findings', 'Which fixes should I do first?', 'Are any of these false positives?'].map(s => (
            <button key={s} className="chat__sugg" onClick={() => handleSend(s)} disabled={isBusy}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.5 5H18l-4.5 3.5L15 17l-3-2.5L9 17l1.5-5.5L6 8h4.5z"/>
              </svg>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={`chat__composer${isBusy ? ' chat__composer--busy' : ''}`}>
        {isBusy && (
          <div className="chat__thinking" role="status" aria-live="polite">
            <span className="chat__thinking-spinner" aria-hidden="true" />
            <span>Thinking… Ask again when done.</span>
          </div>
        )}
        <div className="chat__composer-box">
          <textarea
            ref={taRef}
            rows={1}
            placeholder={isBusy ? 'Waiting for AI…' : 'Ask AI about a finding, the diff, or your fix plan…'}
            value={draft}
            disabled={isBusy}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="chat__composer-row">
            <span className="chat__model">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              {providerLabel} · {chatModelLabel}
            </span>
            <span style={{ flex: 1 }} />
            {streaming ? (
              <button className="chat__stop" onClick={abort}>
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="currentColor" stroke="none"/>
                </svg>
              </button>
            ) : (
              <button
                className="chat__send"
                onClick={() => handleSend()}
                disabled={!draft.trim() || isBusy}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

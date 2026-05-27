import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  onSave: (text: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  onAskAI?: (text: string) => void;
}

export default function GlobalCommentPopover({ value, onSave, onClose, anchorRef, onAskAI }: Props) {
  const [text, setText] = useState(value);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose, anchorRef]);

  function handleAdd() {
    onSave(text);
    onClose();
  }

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        top: '48px',
        right: '8px',
        zIndex: 200,
        width: '400px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--fg-strong)' }}>Global Comment</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            title="Expand to right panel"
            onClick={() => { onSave(text); if (onAskAI) onAskAI(text); onClose(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-faint)', fontSize: '14px', padding: '2px 4px' }}
          >⤢</button>
          <button
            title="Close"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-faint)', fontSize: '16px', padding: '2px 4px' }}
          >×</button>
        </div>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Add an overall note about this review…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-input)',
            color: 'var(--fg-default)',
            border: '1px solid var(--border-focus)',
            borderRadius: '4px',
            padding: '8px',
            fontSize: '13px',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', gap: '8px' }}>
        {onAskAI && (
          <button
            onClick={() => { onSave(text); onAskAI(text); onClose(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '12px', padding: '4px 8px' }}
            title="Open in chat panel"
          >✦ Ask AI</button>
        )}
        <button
          onClick={handleAdd}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
        >Add</button>
      </div>
    </div>
  );
}

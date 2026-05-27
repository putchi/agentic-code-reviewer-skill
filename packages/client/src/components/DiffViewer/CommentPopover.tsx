import { useRef, useEffect } from 'react';
import type { Selection } from '../../hooks/useAnnotations';

interface Props {
  selection: Selection | null;
  anchorRect: DOMRect | null;
  initialText?: string;
  onSave: (text: string) => void;
  onAskAI: (prompt: string) => void;
  onClose: () => void;
}

export default function CommentPopover({ selection, anchorRect, initialText = '', onSave, onAskAI, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.value = initialText;
      taRef.current.focus();
    }
  }, [selection, initialText]);

  if (!selection || !anchorRect) return null;

  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 220);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 336));

  const lineRange = selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}–${selection.lineEnd}`;

  function handleSave() {
    const text = taRef.current?.value.trim() || '';
    if (text) onSave(text);
    onClose();
  }

  function handleSaveAndAsk() {
    const text = taRef.current?.value.trim() || '';
    const fence = '```';
    const prompt = `Re: ${selection!.file} ${lineRange}\n${fence}\n${selection!.linesText}\n${fence}\n\n${text}`;
    onAskAI(prompt);
    if (text) onSave(text);
    onClose();
  }

  return (
    <div className="comment-popover" style={{ top, left }}>
      <div className="comment-popover__loc">
        {selection.file} · {lineRange}
      </div>
      <textarea
        ref={taRef}
        className="comment-popover__textarea"
        placeholder="Add comment…"
        rows={3}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
        }}
      />
      <div className="comment-popover__actions">
        <button className="btn btn--sm btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--sm btn--ghost" onClick={handleSaveAndAsk}>Ask AI</button>
        <button className="btn btn--sm btn--primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}

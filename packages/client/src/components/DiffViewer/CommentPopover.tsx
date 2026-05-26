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
  useEffect(() => { if (taRef.current) { taRef.current.value = initialText; taRef.current.focus(); } }, [selection, initialText]);

  if (!selection || !anchorRect) return null;
  const top = anchorRect.bottom + 8;
  const left = Math.min(anchorRect.left, window.innerWidth - 280);

  function handleSaveAndAsk() {
    const text = taRef.current?.value.trim() || '';
    const fence = '```';
    const lineRange = selection!.lineStart === selection!.lineEnd
      ? `line ${selection!.lineStart}`
      : `lines ${selection!.lineStart}–${selection!.lineEnd}`;
    const prompt = `Re: ${selection!.file} ${lineRange}\n${fence}\n${selection!.linesText}\n${fence}\n\n${text}`;
    onAskAI(prompt);
    if (text) onSave(text);
    onClose();
  }

  return (
    <div id="comment-popover" style={{ top, left, display: 'block' }}>
      <div className="popover-label">
        {selection.file} lines {selection.lineStart}–{selection.lineEnd}
      </div>
      <textarea ref={taRef} className="popover-textarea" placeholder="Add comment…" rows={3}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }} />
      <div className="popover-actions">
        <button className="btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn-sm" onClick={handleSaveAndAsk}>Ask AI</button>
        <button className="btn-sm btn-primary" onClick={() => { onSave(taRef.current?.value.trim() || ''); onClose(); }}>Save</button>
      </div>
    </div>
  );
}

import { useRef, useEffect } from 'react';
import type { Selection } from '../../hooks/useAnnotations';

const draftMap = new Map<string, string>();
const MAX_DRAFTS = 100;
function setDraft(key: string, value: string) {
  // Re-insert to refresh recency, then FIFO-evict — keeps abandoned drafts bounded
  draftMap.delete(key);
  draftMap.set(key, value);
  while (draftMap.size > MAX_DRAFTS) {
    const oldest = draftMap.keys().next().value;
    if (oldest === undefined) break;
    draftMap.delete(oldest);
  }
}

interface Props {
  selection: Selection | null;
  anchorRect: DOMRect | null;
  initialText?: string;
  draftKey?: string;
  onSave: (text: string) => void;
  onAskAI: (prompt: string) => void;
  onClose: () => void;
}

export default function CommentPopover({ selection, anchorRect, initialText = '', draftKey, onSave, onAskAI, onClose }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (taRef.current) {
      const draft = draftKey ? draftMap.get(draftKey) : undefined;
      taRef.current.value = (draft !== undefined && !initialText) ? draft : initialText;
      taRef.current.focus();
    }
  }, [selection, initialText, draftKey]);

  if (!selection || !anchorRect) return null;

  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 220);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 336));

  const lineRange = selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}–${selection.lineEnd}`;

  function clearDraft() {
    if (draftKey) draftMap.delete(draftKey);
  }

  function handleSave() {
    const text = taRef.current?.value.trim() || '';
    if (text) onSave(text);
    clearDraft();
    onClose();
  }

  function handleSaveAndAsk() {
    const text = taRef.current?.value.trim() || '';
    const fence = '```';
    const prompt = `Re: ${selection!.file} ${lineRange}\n${fence}\n${selection!.linesText}\n${fence}\n\n${text}`;
    onAskAI(prompt);
    if (text) onSave(text);
    clearDraft();
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
        onChange={e => { if (draftKey) setDraft(draftKey, e.target.value); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { clearDraft(); onClose(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
        }}
      />
      <div className="comment-popover__actions">
        <button className="btn btn--sm btn--ghost" onClick={() => { clearDraft(); onClose(); }}>Cancel</button>
        <button className="btn btn--sm btn--ghost" onClick={handleSaveAndAsk}>Ask AI</button>
        <button className="btn btn--sm btn--primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}

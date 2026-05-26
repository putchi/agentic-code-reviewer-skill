import { useState, useRef } from 'react';
import type { Finding } from '@acr/shared';
import type { LineAnnotation } from '@acr/shared';
import { postDecision } from '../lib/api';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  autoCloseMs: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function ActionBar({ findings, checkedIds, comments, globalComment, lineAnnotations, autoCloseMs, onSelectAll, onDeselectAll }: Props) {
  const [status, setStatus] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildPayload() {
    const selectedIds = Array.from(checkedIds);
    const commentMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(comments)) {
      if (k.startsWith('_comment_') && v) commentMap[k.slice(9)] = v;
    }
    const gComment = comments['_global'] || globalComment;
    return { selectedIds, comments: commentMap, globalComment: gComment, lineAnnotations };
  }

  function startCountdown() {
    if (autoCloseMs <= 0) return;
    let remaining = Math.round(autoCloseMs / 1000);
    setStatus(`Closing in ${remaining}… `);
    countdownRef.current = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        window.close();
      } else {
        setStatus(`Closing in ${remaining}… `);
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setStatus('');
  }

  async function handleImplement() {
    if (checkedIds.size === 0) return;
    setStatus('Sending…');
    await postDecision('implement', buildPayload());
    startCountdown();
  }

  async function handleSave() {
    setStatus('Saving…');
    const result = await postDecision('save', buildPayload());
    if (autoCloseMs > 0) {
      startCountdown();
    } else {
      setStatus(result.path ? `Saved to ${result.path.split('/').pop()}` : 'Saved');
      setTimeout(() => setStatus(''), 3000);
    }
  }

  async function handleDone() {
    setStatus('Done');
    await postDecision('done', buildPayload());
    startCountdown();
  }

  const isCountingDown = countdownRef.current !== null;

  return (
    <div className="action-bar">
      <div className="sel-controls">
        <button className="btn btn-sm" onClick={onSelectAll}>Select All</button>
        <button className="btn btn-sm" onClick={onDeselectAll}>Deselect All</button>
      </div>
      <div className="action-spacer" />
      {status && (
        <span className="status-msg">
          {status}
          {isCountingDown && (
            <button className="btn btn-sm" style={{ marginLeft: 8, fontSize: 11 }} onClick={cancelCountdown}>
              Cancel
            </button>
          )}
        </span>
      )}
      <button className="btn btn-primary" disabled={checkedIds.size === 0} onClick={handleImplement}>
        Implement
      </button>
      <button className="btn" onClick={handleSave}>Save</button>
      <button className="btn" onClick={handleDone}>Done</button>
    </div>
  );
}

import { useState, useRef } from 'react';
import type { LineAnnotation } from '@acr/shared';
import { postDecision, buildDecisionPayload } from '../lib/api';
import DismissModal from './ActionBar/DismissModal';

interface Props {
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  autoCloseMs: number;
  dismissedIds: Set<string>;
  dismissReasons: Record<string, string>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDismiss: (ids: string[], reason: string) => void;
  onCloseRequest: () => void;
}

export default function ActionBar({
  checkedIds, comments, globalComment, lineAnnotations, autoCloseMs,
  dismissedIds, dismissReasons, onSelectAll, onDeselectAll, onDismiss, onCloseRequest,
}: Props) {
  const [status, setStatus] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildPayload() {
    return buildDecisionPayload({ checkedIds, comments, globalComment, lineAnnotations, dismissedIds, dismissReasons });
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


  function handleDismissConfirm(reason: string) {
    onDismiss(Array.from(checkedIds), reason);
    setShowDismiss(false);
  }

  const isCountingDown = countdownRef.current !== null;

  return (
    <>
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
        <button className="btn btn-primary" disabled={checkedIds.size === 0} onClick={handleImplement}
          title="Send selected findings to the implementation plan and close">
          Implement
        </button>
        <button className="btn btn-dismiss" disabled={checkedIds.size === 0} onClick={() => setShowDismiss(true)}
          title="Mark selected findings as won't-fix or false positive">
          Dismiss
        </button>
        <button className="btn btn-outline" onClick={handleSave}
          title="Save findings and decisions to a markdown file — review stays open">
          Save
        </button>
        <button className="btn btn-ghost" onClick={onCloseRequest}
          title="Exit without saving">
          Close
        </button>
      </div>
      {showDismiss && (
        <DismissModal
          count={checkedIds.size}
          onConfirm={handleDismissConfirm}
          onCancel={() => setShowDismiss(false)}
        />
      )}
    </>
  );
}

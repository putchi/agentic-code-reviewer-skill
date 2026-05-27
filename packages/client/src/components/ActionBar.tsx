import { useState, useRef } from 'react';
import type { LineAnnotation } from '@acr/shared';
import { buildDecisionPayload } from '@acr/shared';
import { postDecision } from '../lib/api';
import DismissModal from './ActionBar/DismissModal';

interface Props {
  checkedIds: Set<string>;
  comments: Record<string, string>;
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
  checkedIds, comments, lineAnnotations, autoCloseMs,
  dismissedIds, dismissReasons, onSelectAll, onDeselectAll, onDismiss, onCloseRequest,
}: Props) {
  const [status, setStatus] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function buildPayload() {
    return buildDecisionPayload({ checkedIds, comments, lineAnnotations, dismissedIds, dismissReasons });
  }

  // Implement always uses at least 3s countdown so the user sees the tab will close.
  function startCountdown(minMs = 0) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const ms = Math.max(autoCloseMs, minMs);
    if (ms <= 0) return;
    let remaining = Math.round(ms / 1000);
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
    // Implement always closes — enforce minimum 3s countdown.
    startCountdown(3000);
  }

  async function handleDismissConfirm(reason: string) {
    onDismiss(Array.from(checkedIds), reason);
    setShowDismiss(false);
    setStatus('Saving…');
    // Rebuild payload with newly-dismissed IDs included via the updated state.
    // Because state updates are async, compute updated sets locally.
    const updatedDismissedIds = new Set([...dismissedIds, ...checkedIds]);
    const updatedDismissReasons = { ...dismissReasons };
    for (const id of checkedIds) { if (reason) updatedDismissReasons[id] = reason; }
    const updatedCheckedIds = new Set([...checkedIds].filter(id => !updatedDismissedIds.has(id)));
    const payload = buildDecisionPayload({
      checkedIds: updatedCheckedIds,
      comments,
      lineAnnotations,
      dismissedIds: updatedDismissedIds,
      dismissReasons: updatedDismissReasons,
    });
    await postDecision('save', payload);
    startCountdown();
    if (!countdownRef.current) setStatus('Dismissed');
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
        <button className="btn btn-ghost" onClick={onCloseRequest}
          title="Exit and save report">
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

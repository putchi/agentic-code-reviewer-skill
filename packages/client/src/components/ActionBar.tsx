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

// SVG Icons
const WandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 4V2m0 14v-2M8 9H2m14 0h-2M4 20l3-3M17 7l-3 3M14 14l3 3M3 3l3 3" />
  </svg>
);

const BanIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface CountdownState {
  seconds: number;
  total: number;
  action: 'implement' | 'dismiss';
  count: number;
  savePath?: string;
}

export default function ActionBar({
  checkedIds, comments, lineAnnotations, autoCloseMs,
  dismissedIds, dismissReasons, onSelectAll, onDeselectAll, onDismiss, onCloseRequest,
}: Props) {
  const [showDismiss, setShowDismiss] = useState(false);
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track total items for use in the overlay after checkedIds may have changed
  const pendingCountRef = useRef(0);
  const pendingActionRef = useRef<'implement' | 'dismiss'>('implement');

  function buildPayload() {
    return buildDecisionPayload({ checkedIds, comments, lineAnnotations, dismissedIds, dismissReasons });
  }

  // Implement always uses at least 3s countdown so the user sees the tab will close.
  function startCountdown(minMs = 0, action: 'implement' | 'dismiss' = 'implement', count = 0, savePath?: string) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const ms = Math.max(autoCloseMs, minMs);
    if (ms <= 0) return;
    let remaining = Math.round(ms / 1000);
    setCountdown({ seconds: remaining, total: remaining, action, count, savePath });
    countdownRef.current = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        window.close();
      } else {
        setCountdown(prev => prev ? { ...prev, seconds: remaining } : null);
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }

  async function handleImplement() {
    if (checkedIds.size === 0) return;
    pendingCountRef.current = checkedIds.size;
    pendingActionRef.current = 'implement';
    await postDecision('implement', buildPayload());
    // Implement always closes — enforce minimum 3s countdown.
    startCountdown(3000, 'implement', pendingCountRef.current);
  }

  async function handleDismissConfirm(reason: string) {
    const count = checkedIds.size;
    onDismiss(Array.from(checkedIds), reason);
    setShowDismiss(false);
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
    startCountdown(0, 'dismiss', count);
    if (!countdownRef.current) {
      // autoCloseMs was 0 — no countdown started, nothing to show
    }
  }

  const isCountingDown = countdown !== null;
  const totalItems = dismissedIds.size + checkedIds.size;

  // Ring animation: circumference = 2 * pi * 12 ≈ 75.4
  const CIRCUMFERENCE = 75.4;
  const ringProgress = countdown
    ? ((countdown.total - countdown.seconds) / countdown.total) * CIRCUMFERENCE
    : 0;

  return (
    <>
      <div className="abar">
        <div className="abar__left">
          <button className="btn btn--ghost" onClick={onSelectAll}>Select all</button>
          <button className="btn btn--ghost" onClick={onDeselectAll}>Deselect all</button>
          <span className="abar__sel">
            <strong>{checkedIds.size}</strong> of {totalItems} selected
          </span>
        </div>
        <div className="abar__spacer" />
        <div className="abar__right">
          <button
            className="btn btn--cta"
            disabled={checkedIds.size === 0}
            onClick={handleImplement}
            title="Send selected findings to the implementation plan and close"
          >
            <WandIcon /> Implement
          </button>
          <button
            className="btn btn--danger"
            disabled={checkedIds.size === 0}
            onClick={() => setShowDismiss(true)}
            title="Mark selected findings as won't-fix or false positive"
          >
            <BanIcon /> Dismiss
          </button>
          <button
            className="btn"
            onClick={onCloseRequest}
            title="Exit and save report"
          >
            <XIcon /> Close
          </button>
        </div>

        {isCountingDown && countdown && (
          <div className="countdown">
            <div className="countdown__ring">
              <style>{`
                @keyframes acr-ring {
                  from { stroke-dashoffset: 0; }
                  to { stroke-dashoffset: ${CIRCUMFERENCE}; }
                }
              `}</style>
              <svg width="30" height="30">
                <circle
                  cx="15" cy="15" r="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={ringProgress}
                  style={{
                    animation: `acr-ring ${countdown.total}s linear forwards`,
                    transformOrigin: '15px 15px',
                    transform: 'rotate(-90deg)',
                  }}
                />
              </svg>
              <span className="countdown__ring-num">{countdown.seconds}</span>
            </div>
            <div className="countdown__text">
              <div className="countdown__title">
                {countdown.action === 'implement'
                  ? `Implementing ${countdown.count} fix${countdown.count !== 1 ? 'es' : ''} — closing in ${countdown.seconds}s`
                  : `Dismissing ${countdown.count} finding${countdown.count !== 1 ? 's' : ''} — closing in ${countdown.seconds}s`}
              </div>
              {countdown.savePath && (
                <div className="countdown__sub">{countdown.savePath}</div>
              )}
            </div>
            <button className="btn btn--ghost" onClick={cancelCountdown}>Cancel</button>
          </div>
        )}
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

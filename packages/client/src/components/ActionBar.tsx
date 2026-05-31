import { useMemo, useState } from 'react';
import type { FindingAction, LineAnnotation } from '@acr/shared';
import { buildDecisionPayload } from '@acr/shared';
import { postDecision } from '../lib/api';
import { actionLabel, isImplementAction } from '../lib/findingActions';

interface Props {
  runId?: string;
  totalFindings: number;
  findingActions: Record<string, FindingAction | ''>;
  comments: Record<string, string>;
  lineAnnotations: Record<string, LineAnnotation>;
  resumeCommand?: string;
  onCloseRequest: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onImplement: () => void;
  onDismiss: () => void;
  finalizing?: boolean;
}

const SaveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const BanIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);

export default function ActionBar({
  runId, totalFindings, findingActions, comments, lineAnnotations, resumeCommand, onCloseRequest,
  onSelectAll, onClearSelection, onImplement, onDismiss, finalizing = false,
}: Props) {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const action of Object.values(findingActions)) {
      if (!action) continue;
      counts[action] = (counts[action] || 0) + 1;
    }
    return counts;
  }, [findingActions]);

  const decidedCount = Object.values(findingActions).filter(Boolean).length;
  const implementCount = Object.values(findingActions).filter(isImplementAction).length;

  function buildPayload() {
    return buildDecisionPayload({ runId, findingActions, comments, lineAnnotations });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await postDecision('save', buildPayload());
      setSavedPath(result.path || 'decisions saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="abar">
      <div className="abar__left">
        <span className="abar__sel">
          <strong>{implementCount}</strong> of {totalFindings} selected
        </span>
        <div className="abar__bulk">
          <button className="btn btn--xs btn--ghost" onClick={onSelectAll} disabled={finalizing || totalFindings === 0}>All</button>
          <button className="btn btn--xs btn--ghost" onClick={onClearSelection} disabled={finalizing || implementCount === 0}>None</button>
        </div>
        <div className="abar__actions-summary">
          {decidedCount > 0 && <span>{decidedCount} decided</span>}
          {Object.entries(actionCounts).map(([action, count]) => (
            <span key={action}>{actionLabel(action as FindingAction)}: {count}</span>
          ))}
        </div>
      </div>
      <div className="abar__spacer" />
      {resumeCommand && (
        <span className="abar__resume mono" title="Run this in the host agent after saving decisions">
          {resumeCommand}
        </span>
      )}
      {savedPath && <span className="abar__saved">{savedPath}</span>}
      <div className="abar__right">
        <button
          className="btn btn--primary"
          disabled={finalizing || implementCount === 0}
          onClick={onImplement}
          title="Save selected findings for implementation, close this tab, and resume the agent"
        >
          <PlayIcon /> Implement
        </button>
        <button
          className="btn btn--danger"
          disabled={finalizing || totalFindings === 0}
          onClick={onDismiss}
          title={implementCount > 0 ? 'Dismiss selected findings with a reason' : 'Dismiss all findings with a reason'}
        >
          <BanIcon /> Dismiss
        </button>
        <button
          className="btn btn--cta"
          disabled={saving || finalizing}
          onClick={handleSave}
          title="Write decisions.json and markdown report"
        >
          <SaveIcon /> {saving ? 'Saving…' : 'Save decisions'}
        </button>
        <button
          className="btn"
          onClick={onCloseRequest}
          disabled={finalizing}
          title="Exit and save decisions"
        >
          <XIcon /> Close
        </button>
      </div>
    </div>
  );
}

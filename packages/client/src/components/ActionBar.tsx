import { useMemo, useState } from 'react';
import type { FindingAction, LineAnnotation } from '@acr/shared';
import { buildDecisionPayload } from '@acr/shared';
import { postDecision } from '../lib/api';
import { actionLabel } from '../lib/findingActions';

interface Props {
  runId?: string;
  totalFindings: number;
  findingActions: Record<string, FindingAction | ''>;
  comments: Record<string, string>;
  lineAnnotations: Record<string, LineAnnotation>;
  resumeCommand?: string;
  onCloseRequest: () => void;
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

export default function ActionBar({
  runId, totalFindings, findingActions, comments, lineAnnotations, resumeCommand, onCloseRequest,
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
          <strong>{decidedCount}</strong> of {totalFindings} decided
        </span>
        <div className="abar__actions-summary">
          {Object.entries(actionCounts).map(([action, count]) => (
            <span key={action}>{actionLabel(action as FindingAction)}: {count}</span>
          ))}
        </div>
      </div>
      <div className="abar__spacer" />
      {resumeCommand && (
        <span className="abar__resume mono" title="Run this in Claude Code after saving decisions">
          {resumeCommand}
        </span>
      )}
      {savedPath && <span className="abar__saved">{savedPath}</span>}
      <div className="abar__right">
        <button
          className="btn btn--cta"
          disabled={saving}
          onClick={handleSave}
          title="Write decisions.json and markdown report"
        >
          <SaveIcon /> {saving ? 'Saving…' : 'Save decisions'}
        </button>
        <button
          className="btn"
          onClick={onCloseRequest}
          title="Exit and save decisions"
        >
          <XIcon /> Close
        </button>
      </div>
    </div>
  );
}

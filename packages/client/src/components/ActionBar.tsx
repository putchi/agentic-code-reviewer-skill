import { useState } from 'react';
import type { Finding } from '@acr/shared';
import type { LineAnnotation } from '@acr/shared';
import { postDecision } from '../lib/api';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function ActionBar({ findings, checkedIds, comments, globalComment, lineAnnotations, onSelectAll, onDeselectAll }: Props) {
  const [status, setStatus] = useState('');

  function buildPayload(action: 'implement' | 'save' | 'done') {
    const selectedIds = Array.from(checkedIds);
    const commentMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(comments)) {
      if (k.startsWith('_comment_') && v) commentMap[k.slice(9)] = v;
    }
    const gComment = comments['_global'] || globalComment;
    return { selectedIds, comments: commentMap, globalComment: gComment, lineAnnotations };
  }

  async function handleImplement() {
    if (checkedIds.size === 0) return;
    setStatus('Sending…');
    await postDecision('implement', buildPayload('implement'));
  }

  async function handleSave() {
    setStatus('Saving…');
    const result = await postDecision('save', buildPayload('save'));
    setStatus(result.path ? `Saved to ${result.path.split('/').pop()}` : 'Saved');
    setTimeout(() => setStatus(''), 3000);
  }

  async function handleDone() {
    setStatus('Done');
    await postDecision('done', buildPayload('done'));
  }

  return (
    <div className="action-bar">
      <div className="sel-controls">
        <button className="btn btn-sm" onClick={onSelectAll}>Select All</button>
        <button className="btn btn-sm" onClick={onDeselectAll}>Deselect All</button>
      </div>
      <div className="action-spacer" />
      {status && <span className="status-msg">{status}</span>}
      <button className="btn btn-primary" disabled={checkedIds.size === 0} onClick={handleImplement}>
        Implement
      </button>
      <button className="btn" onClick={handleSave}>Save</button>
      <button className="btn" onClick={handleDone}>Done</button>
    </div>
  );
}

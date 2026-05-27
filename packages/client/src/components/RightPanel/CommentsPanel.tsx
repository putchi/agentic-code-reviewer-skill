import type { Finding, FindingAction, LineAnnotation } from '@acr/shared';
import { SevBadge } from '../atoms';
import { actionLabel } from '../../lib/findingActions';

interface Props {
  findings: Finding[];
  findingActions: Record<string, FindingAction | ''>;
  comments: Record<string, string>;
  annotations: Record<string, LineAnnotation>;
  onCommentChange: (id: string, text: string) => void;
  onRemoveAnnotation: (key: string) => void;
}

export default function CommentsPanel({
  findings, findingActions, comments, annotations, onCommentChange, onRemoveAnnotation,
}: Props) {
  const decidedFindings = findings.filter(f => findingActions[f.id]);
  const annotEntries = Object.entries(annotations);

  if (decidedFindings.length === 0 && annotEntries.length === 0) {
    return (
      <div className="rp__content">
        <div className="rp__empty">
          <div className="rp__empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ color: 'var(--fg-default)', fontWeight: 500, marginBottom: 4 }}>No finding decisions</div>
          <div>Choose actions on the left to add per-finding instructions for Claude.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rp__content">
      {decidedFindings.length > 0 && (
        <div className="cmt-list">
          {decidedFindings.map(f => (
            <div className="cmt" key={f.id}>
              <div className="cmt__row1">
                <SevBadge severity={f.severity} />
                <span className="cmt__loc" title={f.file}>
                  {f.file}<span style={{ color: 'var(--fg-disabled)' }}>:{f.line ?? ''}</span>
                </span>
                <span className="cmt__action">{actionLabel(findingActions[f.id])}</span>
              </div>
              <div className="cmt__title">{f.finding}</div>
              <textarea
                className="cmt__textarea"
                placeholder="Add a comment for Claude (optional)…"
                value={comments[f.id] || ''}
                onChange={e => onCommentChange(f.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {annotEntries.length > 0 && (
        <div className="cmt-list" style={{ marginTop: decidedFindings.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', padding: '0 0 6px 0' }}>
            Line annotations
          </div>
          {annotEntries.map(([key, ann]) => {
            const lineRange = ann.lineStart === ann.lineEnd
              ? String(ann.lineStart)
              : `${ann.lineStart}–${ann.lineEnd}`;
            return (
              <div className="cmt cmt--annotation" key={key}>
                <div className="cmt__row1 cmt__row1--annotation">
                  <span className="cmt__loc" title={ann.file}>
                    {ann.file}<span style={{ color: 'var(--fg-disabled)' }}>:{lineRange}</span>
                  </span>
                  <span className="cmt__type">
                    {ann.type}
                  </span>
                  <button
                    className="cmt__delete"
                    onClick={() => onRemoveAnnotation(key)}
                    title="Remove annotation"
                    aria-label="Remove annotation"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>
                <div className="cmt__title" style={{ whiteSpace: 'pre-wrap' }}>{ann.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

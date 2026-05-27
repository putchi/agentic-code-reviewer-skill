import type { Finding } from '@acr/shared';
import { SevBadge } from '../atoms';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  onCommentChange: (id: string, text: string) => void;
}

export default function CommentsPanel({ findings, checkedIds, comments, onCommentChange }: Props) {
  const checkedFindings = findings.filter(f => checkedIds.has(f.id));

  if (checkedFindings.length === 0) {
    return (
      <div className="rp__content">
        <div className="rp__empty">
          <div className="rp__empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ color: 'var(--fg-default)', fontWeight: 500, marginBottom: 4 }}>No checked findings</div>
          <div>Check findings on the left to add per-finding instructions for Claude.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rp__content">
      <div className="cmt-list">
        {checkedFindings.map(f => (
          <div className="cmt" key={f.id}>
            <div className="cmt__row1">
              <SevBadge severity={f.severity} />
              <span className="cmt__loc" title={f.file}>
                {f.file}<span style={{ color: 'var(--fg-disabled)' }}>:{f.line ?? ''}</span>
              </span>
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
    </div>
  );
}

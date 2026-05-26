import type { Finding } from '@acr/shared';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  onCommentChange: (id: string, text: string) => void;
  onGlobalChange: (text: string) => void;
}

export default function CommentsPanel({ findings, checkedIds, comments, globalComment, onCommentChange, onGlobalChange }: Props) {
  const checked = findings.filter(f => checkedIds.has(f.id));
  return (
    <>
      <div className="comments-scroll" style={{ flex: 1 }}>
        {checked.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', padding: '8px' }}>
            Check findings to add comments.
          </div>
        )}
        {checked.map(f => (
          <div key={f.id} className="comment-card">
            <div className="comment-card-header">
              <span className={`badge badge-${f.severity}`}>{f.severity}</span>
              <span className="comment-location">{f.location}</span>
            </div>
            <div className="finding-detail">{f.finding}</div>
            {f.evidence && <div className="evidence-block">{f.evidence}</div>}
            <textarea className="comment-input"
              placeholder="Add comment for Claude…"
              value={comments[`_comment_${f.id}`] || ''}
              onChange={e => onCommentChange(`_comment_${f.id}`, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="global-comment-area">
        <div className="global-comment-label">Global Notes</div>
        <textarea className="global-textarea"
          placeholder="Overall notes for Claude…"
          value={globalComment}
          onChange={e => onGlobalChange(e.target.value)} />
      </div>
    </>
  );
}

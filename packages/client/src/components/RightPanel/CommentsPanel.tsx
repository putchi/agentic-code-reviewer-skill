import type { Finding } from '@acr/shared';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  onCommentChange: (id: string, text: string) => void;
}

export default function CommentsPanel({ findings, checkedIds, comments, onCommentChange }: Props) {
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

            <textarea className="comment-input"
              placeholder="Add comment for Claude…"
              value={comments[`_comment_${f.id}`] || ''}
              onChange={e => onCommentChange(`_comment_${f.id}`, e.target.value)} />
          </div>
        ))}
      </div>
    </>
  );
}

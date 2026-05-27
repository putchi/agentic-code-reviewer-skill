import type { Finding, LineAnnotation } from '@acr/shared';
import { SevBadge } from '../atoms';
import { useAnnotations } from '../../hooks/useAnnotations';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  onCommentChange: (id: string, text: string) => void;
}

export default function CommentsPanel({ findings, checkedIds, comments, onCommentChange }: Props) {
  const checkedFindings = findings.filter(f => checkedIds.has(f.id));
  const { annotations, removeAnnotation } = useAnnotations();
  const annotEntries = Object.entries(annotations);

  if (checkedFindings.length === 0 && annotEntries.length === 0) {
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
      {checkedFindings.length > 0 && (
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
      )}

      {annotEntries.length > 0 && (
        <div className="cmt-list" style={{ marginTop: checkedFindings.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted)', padding: '0 0 6px 0' }}>
            Line annotations
          </div>
          {annotEntries.map(([key, ann]) => {
            const lineRange = ann.lineStart === ann.lineEnd
              ? String(ann.lineStart)
              : `${ann.lineStart}–${ann.lineEnd}`;
            return (
              <div className="cmt" key={key} style={{ position: 'relative' }}>
                <div className="cmt__row1" style={{ justifyContent: 'space-between' }}>
                  <span className="cmt__loc" title={ann.file}>
                    {ann.file}<span style={{ color: 'var(--fg-disabled)' }}>:{lineRange}</span>
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                    padding: '1px 5px', borderRadius: 3,
                    background: 'var(--bg-subtle)', color: 'var(--fg-muted)',
                  }}>
                    {ann.type}
                  </span>
                </div>
                <div className="cmt__title" style={{ whiteSpace: 'pre-wrap' }}>{ann.text}</div>
                <button
                  onClick={() => removeAnnotation(key)}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--fg-muted)', fontSize: 14, lineHeight: 1, padding: '2px 4px',
                  }}
                  title="Remove annotation"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

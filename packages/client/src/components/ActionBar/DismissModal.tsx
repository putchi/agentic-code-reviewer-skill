import { useState } from 'react';

interface Props {
  count: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function DismissModal({ count, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Dismiss {count} finding{count !== 1 ? 's' : ''}?</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12 }}>
            These findings will be marked as dismissed (won't-fix / false positive).
            You can restore them later by clicking on them in the list.
          </p>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            Reason (optional)
          </label>
          <input
            className="comment-input"
            style={{ minHeight: 'unset', height: 36, resize: 'none' }}
            type="text"
            placeholder="e.g. false positive, won't fix, out of scope…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(reason); if (e.key === 'Escape') onCancel(); }}
            autoFocus
          />
        </div>
        <div className="modal-footer" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-dismiss" onClick={() => onConfirm(reason)}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

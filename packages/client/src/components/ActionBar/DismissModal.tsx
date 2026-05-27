import { useState } from 'react';

interface Props {
  count: number;
  scope: 'selected' | 'all';
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function DismissModal({ count, scope, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const reasonText = reason.trim();
  const targetLabel = scope === 'all'
    ? `all ${count} finding${count !== 1 ? 's' : ''}`
    : `${count} finding${count !== 1 ? 's' : ''}`;

  return (
    <div className="modal__scrim" onClick={onCancel}>
      <div className="modal modal--compact" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">
            Dismiss {targetLabel}?
          </h2>
          <button className="btn btn--sm btn--icon btn--ghost modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal__body modal__body--single">
          <div className="modal__main">
          <p>
            These findings will be marked as dismissed and saved as the final decision.
          </p>
          <label className="field__label">
            Reason
          </label>
          <input
            className="comment-input"
            type="text"
            placeholder="False positive, won't fix, out of scope"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && reasonText) onConfirm(reasonText); if (e.key === 'Escape') onCancel(); }}
            autoFocus
          />
          </div>
        </div>
        <div className="modal__foot">
          <span className="modal__foot-meta" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-dismiss" onClick={() => onConfirm(reasonText)} disabled={!reasonText}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

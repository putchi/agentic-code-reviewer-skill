import { useState } from 'react';

interface Props {
  count: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function DismissModal({ count, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');

  return (
    <div className="modal__scrim" onClick={onCancel}>
      <div className="modal modal--compact" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">Dismiss {count} finding{count !== 1 ? 's' : ''}?</h2>
          <button className="btn btn--sm btn--icon btn--ghost modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal__body modal__body--single">
          <div className="modal__main">
          <p>
            These findings will be marked as dismissed (won't-fix / false positive).
            You can restore them later by clicking on them in the list.
          </p>
          <label className="field__label">
            Reason (optional)
          </label>
          <input
            className="comment-input"
            type="text"
            placeholder="e.g. false positive, won't fix, out of scope…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(reason); if (e.key === 'Escape') onCancel(); }}
            autoFocus
          />
          </div>
        </div>
        <div className="modal__foot">
          <span className="modal__foot-meta" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-dismiss" onClick={() => onConfirm(reason)}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

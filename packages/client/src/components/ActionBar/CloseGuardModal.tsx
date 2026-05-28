import type { Finding } from '@acr/shared';

interface Props {
  criticalFindings: Finding[];
  onSaveAndClose: () => void;
  onCloseAnyway: () => void;
}

export default function CloseGuardModal({ criticalFindings, onSaveAndClose, onCloseAnyway }: Props) {
  return (
    <div className="modal__scrim" onClick={onCloseAnyway}>
      <div className="modal modal--compact" onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title" style={{ color: 'var(--sev-critical-fg)' }}>
            Unaddressed critical findings
          </h2>
        </div>
        <div className="modal__body modal__body--single">
          <div className="modal__main">
          <p>
            You have {criticalFindings.length} unaddressed critical finding{criticalFindings.length !== 1 ? 's' : ''}.
            Choose an action for each critical finding before closing, or save your current decisions first.
          </p>
          <ul style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {criticalFindings.map(f => (
              <li key={f.id} style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                <span className="mono" style={{ color: 'var(--fg-faint)' }}>{f.location}</span>
                {' — '}{f.finding}
              </li>
            ))}
          </ul>
          </div>
        </div>
        <div className="modal__foot">
          <span className="modal__foot-meta" />
          <button className="btn" onClick={onSaveAndClose}>Save decisions</button>
          <button className="btn btn--ghost" onClick={onCloseAnyway}>Close anyway</button>
        </div>
      </div>
    </div>
  );
}

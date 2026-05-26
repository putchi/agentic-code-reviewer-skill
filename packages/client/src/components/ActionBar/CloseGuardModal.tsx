import type { Finding } from '@acr/shared';

interface Props {
  criticalFindings: Finding[];
  onSaveAndClose: () => void;
  onCloseAnyway: () => void;
}

export default function CloseGuardModal({ criticalFindings, onSaveAndClose, onCloseAnyway }: Props) {
  return (
    <div className="modal-overlay" onClick={onCloseAnyway}>
      <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title" style={{ color: 'var(--critical)' }}>
            ⚠ Unaddressed critical findings
          </span>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12 }}>
            You have {criticalFindings.length} unaddressed critical finding{criticalFindings.length !== 1 ? 's' : ''}.
            These have not been selected for implementation or dismissed.
          </p>
          <ul style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {criticalFindings.map(f => (
              <li key={f.id} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-dim)' }}>{f.location}</span>
                {' — '}{f.finding}
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-footer" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-outline" onClick={onSaveAndClose}>Save for Later</button>
          <button className="btn btn-ghost" onClick={onCloseAnyway}>Close Anyway</button>
        </div>
      </div>
    </div>
  );
}

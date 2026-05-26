import type { Finding } from '@acr/shared';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  checkedIds: Set<string>;
  dismissedIds: Set<string>;
  onSelect: (f: Finding) => void;
  onToggle: (id: string) => void;
  onRestore: (id: string) => void;
}

export default function FindingsList({ findings, selectedId, checkedIds, dismissedIds, onSelect, onToggle, onRestore }: Props) {
  if (!findings.length) {
    return <div className="empty-state">No findings</div>;
  }
  return (
    <>
      {findings.map(f => {
        const dismissed = dismissedIds.has(f.id);
        return (
          <div
            key={f.id}
            className={`finding-item${selectedId === f.id ? ' active' : ''}${dismissed ? ' dismissed' : ''}`}
            style={dismissed ? { opacity: 0.45 } : undefined}
            onClick={() => dismissed ? onRestore(f.id) : onSelect(f)}
            title={dismissed ? 'Click to restore this finding' : undefined}
          >
            <input type="checkbox" checked={checkedIds.has(f.id)}
              disabled={dismissed}
              onChange={e => { e.stopPropagation(); onToggle(f.id); }}
              onClick={e => e.stopPropagation()} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="finding-location">
                <span
                  className={`badge badge-${f.severity}`}
                  style={dismissed ? { textDecoration: 'line-through' } : undefined}
                >
                  {f.severity}
                </span>
                {' '}{f.location}
              </div>
              <div className="finding-text">{f.finding}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

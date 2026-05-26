import type { Finding } from '@acr/shared';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  checkedIds: Set<string>;
  onSelect: (f: Finding) => void;
  onToggle: (id: string) => void;
}

export default function FindingsList({ findings, selectedId, checkedIds, onSelect, onToggle }: Props) {
  if (!findings.length) {
    return <div className="empty-state">No findings</div>;
  }
  return (
    <>
      {findings.map(f => (
        <div key={f.id} className={`finding-item${selectedId === f.id ? ' active' : ''}`}
          onClick={() => onSelect(f)}>
          <input type="checkbox" checked={checkedIds.has(f.id)}
            onChange={e => { e.stopPropagation(); onToggle(f.id); }}
            onClick={e => e.stopPropagation()} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="finding-location">
              <span className={`badge badge-${f.severity}`}>{f.severity}</span>
              {' '}{f.location}
            </div>
            <div className="finding-text">{f.finding}</div>
          </div>
        </div>
      ))}
    </>
  );
}

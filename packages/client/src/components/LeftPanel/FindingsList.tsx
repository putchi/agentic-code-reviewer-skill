import type { Finding } from '@acr/shared';
import { SevBadge, Checkbox } from '../atoms';

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
    return (
      <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 12 }}>
        No findings match this filter.
      </div>
    );
  }
  return (
    <>
      {findings.map(f => {
        const dismissed = dismissedIds.has(f.id);
        const selected = selectedId === f.id;

        const parts = f.file.split('/');
        const fileLast = parts.pop() ?? f.file;
        const dir = parts.join('/');

        return (
          <div
            key={f.id}
            className="finding"
            role="option"
            aria-selected={selected}
            data-selected={selected ? true : undefined}
            data-dismissed={dismissed ? true : undefined}
            style={dismissed ? { opacity: 0.45 } : undefined}
            onClick={() => dismissed ? onRestore(f.id) : onSelect(f)}
          >
            <div className="finding__check">
              <Checkbox
                checked={checkedIds.has(f.id)}
                onChange={() => onToggle(f.id)}
                ariaLabel={`Select finding ${f.finding}`}
                disabled={dismissed}
              />
            </div>
            <div className="finding__body">
              <div className="finding__row1">
                <SevBadge severity={f.severity} />
                <span className="finding__loc" title={f.file}>
                  <strong>{dir}/</strong>{fileLast}<span className="muted">:{f.line ?? ''}</span>
                </span>
              </div>
              <div className="finding__title">{f.finding}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}

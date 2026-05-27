import type { Finding, FindingAction } from '@acr/shared';
import { Checkbox, SevBadge } from '../atoms';
import { actionLabel, isImplementAction } from '../../lib/findingActions';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelect: (f: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
}

export default function FindingsList({ findings, selectedId, findingActions, onSelect, onFindingAction }: Props) {
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
        const selected = selectedId === f.id;
        const action = findingActions[f.id] || '';
        const markedForImplement = isImplementAction(action);

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
            data-action={action || undefined}
            onClick={() => onSelect(f)}
          >
            <div className="finding__check">
              <Checkbox
                checked={markedForImplement}
                ariaLabel={markedForImplement ? 'Deselect finding for implementation' : 'Select finding for implementation'}
                onChange={checked => onFindingAction(f.id, checked ? 'ask_claude_to_implement' : '')}
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
            <span className={`finding__decision${markedForImplement ? ' finding__decision--implement' : action === 'ignore' ? ' finding__decision--dismiss' : ''}`}>
              {actionLabel(action)}
            </span>
          </div>
        );
      })}
    </>
  );
}

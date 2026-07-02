import type { Finding, FindingAction } from '@acr/shared';
import { Checkbox, SevBadge } from '../atoms';
import { actionLabel, isImplementAction } from '../../lib/findingActions';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelect: (f: Finding) => void;
  onOpenFindingDiff: (f: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onAskAI: (prompt: string) => void;
}

export default function FindingsList({ findings, selectedId, findingActions, onSelect, onOpenFindingDiff, onFindingAction, onAskAI }: Props) {
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
                <span className={`finding__decision${markedForImplement ? ' finding__decision--implement' : action === 'ignore' ? ' finding__decision--dismiss' : ''}`}>
                  {actionLabel(action)}
                </span>
              </div>
              <div className="finding__title">{f.finding}</div>
              {selected && (
                <div className="finding__detail">
                  {f.reasoning && (
                    <p className="finding__detail-text">{f.reasoning}</p>
                  )}
                  {f.evidence && (
                    <div className="finding__detail-evidence">{f.evidence}</div>
                  )}
                  <div className="finding__detail-actions">
                    <button
                      className="finding__diff-btn"
                      onClick={e => { e.stopPropagation(); onOpenFindingDiff(f); }}
                    >
                      Open diff ↗
                    </button>
                    <button
                      className="finding__diff-btn"
                      onClick={e => { e.stopPropagation(); onAskAI(`Tell me more about this finding:\n\n**${f.finding}** (${f.file}:${f.line ?? ''})\n\n${f.reasoning ?? ''}`); }}
                    >
                      Ask AI&nbsp;<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginTop:'-1px'}}><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.22 4.22l1.42 1.42M10.36 10.36l1.42 1.42M4.22 11.78l1.42-1.42M10.36 5.64l1.42-1.42"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

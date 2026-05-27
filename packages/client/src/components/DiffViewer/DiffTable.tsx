import type { Finding, FindingAction } from '@acr/shared';
import type { DiffRow } from '../../lib/diff';
import type { LineAnnotation } from '@acr/shared';
import { annotKey } from '../../lib/annotKey';

interface Props {
  rows: DiffRow[];
  file: string;
  findings: Finding[];
  selectedFindingId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  annotations: Record<string, LineAnnotation>;
  selectedLines: Set<string>;
  onRowMouseUp: (e: React.MouseEvent<HTMLTableRowElement>, row: DiffRow) => void;
  onAnnotClick: (key: string, e: React.MouseEvent) => void;
  onSelectFinding: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  splitView: boolean;
}

export default function DiffTable({
  rows, file, findings, selectedFindingId, findingActions, annotations, selectedLines,
  onRowMouseUp, onAnnotClick, onSelectFinding, onFindingAction, splitView,
}: Props) {
  const findingsByLine: Record<number, Finding[]> = {};
  for (const f of findings) {
    if (f.file === file) {
      (findingsByLine[f.line] ??= []).push(f);
    }
  }

  return (
    <table className="diff-table">
      <tbody>
        {rows.map((row, i) => {
          const isAdd = row.type === 'add';
          const isDel = row.type === 'del';
          const isCtx = row.type === 'ctx';
          const isHunk = row.type === 'hunk';
          const lineNum = isAdd || isCtx ? row.newLine : isDel ? row.oldLine : undefined;
          const side = isAdd || isCtx ? 'new' : 'old';
          const key = lineNum !== undefined ? annotKey(file, lineNum, lineNum, side as 'new'|'old') : null;
          const annot = key ? annotations[key] : null;
          const lineFindings = (isAdd || isCtx) && lineNum !== undefined ? (findingsByLine[lineNum] || []) : [];
          const isFlagged = lineFindings.length > 0;
          const hasCritical = lineFindings.some(f => f.severity === 'CRITICAL');

          const rowClass = [
            isAdd ? 'diff-line-add' : isDel ? 'diff-line-del' : isCtx ? 'diff-line-ctx' : 'diff-line-hunk',
            isFlagged ? (hasCritical ? 'diff-flagged-critical' : 'diff-flagged') : '',
            key && selectedLines.has(key) ? 'line-selected' : '',
          ].filter(Boolean).join(' ');

          return (
            <tr key={i} className={rowClass}
              data-line-right={isAdd || isCtx ? row.newLine : undefined}
              data-line-left={isDel || isCtx ? row.oldLine : undefined}
              data-side={side}
              onMouseUp={e => onRowMouseUp(e, row)}>
              <td className="diff-line-num">{isAdd || isCtx ? row.newLine ?? '' : ''}</td>
              <td className="diff-line-num">{isDel || isCtx ? row.oldLine ?? '' : ''}</td>
              <td className="diff-gutter">
                {annot && (
                  <span
                    className={`gutter-dot gutter-dot-${annot.type === 'COMMENT' ? 'ANNOTATION' : annot.type}`}
                    onClick={e => key && onAnnotClick(key, e)} title={annot.text}>●</span>
                )}
                {lineFindings.length > 0 && (
                  <button
                    type="button"
                    className={`gutter-dot gutter-dot-${lineFindings[0].severity}${selectedFindingId === lineFindings[0].id ? ' gutter-dot--selected' : ''}`}
                    title={lineFindings[0].finding}
                    aria-label={`Select finding ${lineFindings[0].finding}`}
                    data-action={findingActions[lineFindings[0].id] || undefined}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      onSelectFinding(lineFindings[0]);
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      onFindingAction(
                        lineFindings[0].id,
                        findingActions[lineFindings[0].id] ? '' : 'ask_claude_to_implement'
                      );
                    }}
                  >●</button>
                )}
              </td>
              <td>{isHunk ? <span style={{ color: 'var(--purple)' }}>{row.text}</span> : row.text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

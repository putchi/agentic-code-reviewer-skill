import type { Finding } from '@acr/shared';
import type { DiffRow } from '../../lib/diff';
import type { LineAnnotation } from '@acr/shared';
import { annotKey } from '../../lib/annotKey';

interface Props {
  rows: DiffRow[];
  file: string;
  findings: Finding[];
  annotations: Record<string, LineAnnotation>;
  selectedLines: Set<string>;
  onRowMouseUp: (e: React.MouseEvent<HTMLTableRowElement>, row: DiffRow) => void;
  onAnnotClick: (key: string, e: React.MouseEvent) => void;
  splitView: boolean;
}

export default function DiffTable({ rows, file, findings, annotations, selectedLines, onRowMouseUp, onAnnotClick, splitView }: Props) {
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
                {!annot && lineFindings.length > 0 && (
                  <span className={`gutter-dot gutter-dot-${lineFindings[0].severity}`} title={lineFindings[0].finding}>●</span>
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

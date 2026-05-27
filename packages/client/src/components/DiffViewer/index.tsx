import { useState, useRef, useCallback } from 'react';
import type { Finding, FindingAction } from '@acr/shared';
import type { LineAnnotation } from '@acr/shared';
import { parseDiff } from '../../lib/diff';
import { annotKey } from '../../lib/annotKey';
import { useAnnotations, type AnnotMode, type Selection } from '../../hooks/useAnnotations';
import DiffTable from './DiffTable';
import AnnotationToolstrip from './AnnotationToolstrip';
import MiniToolbar from './MiniToolbar';
import CommentPopover from './CommentPopover';
import QuickLabelPicker from './QuickLabelPicker';

interface Props {
  file: string | null;
  diffText: string;
  findings: Finding[];
  splitView: boolean;
  selectedFindingId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelectFinding: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onToggleSplit: () => void;
  rightPanelOpen: boolean;
  onShowRightPanel: () => void;
  onHelpModal: () => void;
  onAskAI: (prompt: string) => void;
}

export default function DiffViewer({
  file, diffText, findings, splitView, selectedFindingId, findingActions, onSelectFinding, onFindingAction, onToggleSplit,
  rightPanelOpen, onShowRightPanel, onHelpModal, onAskAI,
}: Props) {
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations();
  const [mode, setMode] = useState<AnnotMode>('markup');
  const [pinpoint, setPinpoint] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [showMini, setShowMini] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  const rows = file ? parseDiff(diffText) : [];

  function clearSelection() {
    setSelection(null);
    setAnchorRect(null);
    setShowMini(false);
    setShowComment(false);
    setShowLabel(false);
    setSelectedLines(new Set());
  }

  function handleMouseUp(e: React.MouseEvent<HTMLTableRowElement>, row: { newLine?: number; oldLine?: number; type: string }) {
    if (pinpoint) {
      // pinpoint mode: click selects single line
      const lineNum = row.newLine ?? row.oldLine;
      if (!lineNum || !file) return;
      const side = row.type === 'del' ? 'old' : 'new';
      const sel: Selection = { file, lineStart: lineNum, lineEnd: lineNum, side: side as 'new'|'old', linesText: '' };
      setSelection(sel);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setAnchorRect(rect);
      if (mode === 'markup') setShowMini(true);
      else if (mode === 'comment') setShowComment(true);
      else if (mode === 'redline') { addAnnotation(sel, 'REDLINE', '~~redline~~'); clearSelection(); }
      else if (mode === 'quickLabel') setShowLabel(true);
      return;
    }

    if (mode !== 'markup' && mode !== 'comment' && mode !== 'quickLabel') return;
    const winSel = window.getSelection();
    if (!winSel || winSel.isCollapsed) return;
    const selectedText = winSel.toString().trim();
    if (!selectedText || !file) return;

    const anchorTr = (e.currentTarget as HTMLElement);
    const lineA = parseInt(anchorTr.dataset.lineRight || anchorTr.dataset.lineLeft || '0');
    const focusTr = winSel.focusNode?.parentElement?.closest('tr') as HTMLElement | null;
    const lineB = focusTr ? parseInt(focusTr.dataset.lineRight || focusTr.dataset.lineLeft || '0') : lineA;
    const lineStart = Math.min(lineA || lineB, lineB || lineA);
    const lineEnd = Math.max(lineA || lineB, lineB || lineA);
    const side = (anchorTr.dataset.side || 'new') as 'new'|'old';

    const newSelected = new Set<string>();
    newSelected.add(annotKey(file, lineStart, lineEnd, side));
    setSelectedLines(newSelected);

    const sel: Selection = { file, lineStart, lineEnd, side, linesText: selectedText };
    setSelection(sel);
    const rect = anchorTr.getBoundingClientRect();
    setAnchorRect(rect);

    if (mode === 'markup') setShowMini(true);
    else if (mode === 'comment') { setShowMini(false); setShowComment(true); }
    else if (mode === 'quickLabel') { setShowMini(false); setShowLabel(true); }
  }

  function handleAnnotClick(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    const parts = key.split('|');
    if (!file) return;
    const sel: Selection = { file: parts[0], lineStart: parseInt(parts[1]), lineEnd: parseInt(parts[2]), side: parts[3] as 'new'|'old', linesText: annotations[key]?.linesText || '' };
    setSelection(sel);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchorRect(rect);
    setShowComment(true);
  }

  function handlePrevFinding() {
    const fileFindings = findings.filter(f => f.file === file);
    if (!fileFindings.length) return;
    // navigate to prev finding in this file — scroll to row
  }

  return (
    <>
      <div className="diff-toolbar">
        <span className="diff-toolbar__filename">{file ?? 'No file selected'}</span>
        <button className="btn btn--sm btn--ghost" onClick={onToggleSplit} title="Toggle split/unified view">
          {splitView ? 'Unified' : 'Split'}
        </button>
        {!rightPanelOpen && (
          <button className="btn btn--sm btn--icon btn--ghost" onClick={onShowRightPanel} title="Show right panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
      </div>

      <AnnotationToolstrip mode={mode} pinpoint={pinpoint}
        onMode={m => { setMode(m); clearSelection(); }}
        onPinpoint={v => { setPinpoint(v); clearSelection(); }}
        onHelp={onHelpModal} />

      <div className={`diff-view${pinpoint ? ' pinpoint-mode' : ''}`}>
        {file ? (
          <DiffTable rows={rows} file={file} findings={findings}
            selectedFindingId={selectedFindingId}
            findingActions={findingActions}
            annotations={annotations} selectedLines={selectedLines}
            onRowMouseUp={handleMouseUp} onAnnotClick={handleAnnotClick}
            onSelectFinding={onSelectFinding}
            onFindingAction={onFindingAction}
            splitView={splitView} />
        ) : (
          <div className="empty-state">Select a finding or file to view diff</div>
        )}
      </div>

      {showMini && (
        <MiniToolbar selection={selection} anchorRect={anchorRect}
          onComment={() => { setShowMini(false); setShowComment(true); }}
          onAskAI={text => { onAskAI(text); setShowMini(false); clearSelection(); }}
          onRedline={() => { if (selection) addAnnotation(selection, 'REDLINE', '~~redline~~'); clearSelection(); }}
          onCancel={clearSelection} />
      )}
      {showComment && (
        <CommentPopover selection={selection} anchorRect={anchorRect}
          draftKey={selection ? annotKey(selection.file, selection.lineStart, selection.lineEnd, selection.side) : undefined}
          initialText={selection ? (annotations[annotKey(selection.file, selection.lineStart, selection.lineEnd, selection.side)]?.text ?? '') : ''}
          onSave={text => { if (selection && text) addAnnotation(selection, 'COMMENT', text); }}
          onAskAI={prompt => onAskAI(prompt)}
          onClose={clearSelection} />
      )}
      {showLabel && (
        <QuickLabelPicker selection={selection} anchorRect={anchorRect}
          onPick={label => { if (selection) addAnnotation(selection, 'LABEL', label); }}
          onClose={clearSelection} />
      )}
    </>
  );
}

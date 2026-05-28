import React, { useState, useEffect } from 'react';
import type { Finding, FindingAction, LineAnnotation, ReviewData } from '@acr/shared';
import type { Selection } from '../../hooks/useAnnotations';
import DiffViewer from '../DiffViewer/index';
import ResultsView from './ResultsView';

interface Props {
  data: ReviewData | null;
  selectedFile: string | null;
  diffText: string;
  findings: Finding[];
  splitView: boolean;
  selectedFindingId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelectFinding: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  rightPanelOpen: boolean;
  onToggleSplit: () => void;
  onShowRightPanel: () => void;
  onHelpModal: () => void;
  onAskAI: (prompt: string) => void;
  annotations: Record<string, LineAnnotation>;
  onAddAnnotation: (sel: Selection, type: LineAnnotation['type'], text: string) => void;
  onFileDeselect: () => void;
}

type Tab = 'results' | 'diff';

function DiffTools() {
  const [view, setView] = React.useState('unified');
  return (
    <div className="tabbar__tools">
      <button className="btn btn--sm btn--ghost" title="Previous finding">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button className="btn btn--sm btn--ghost" title="Next finding">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <span style={{ width: 6 }} />
      <div className="diff__divider" />
      <button
        className={`btn btn--sm btn--icon${view === 'unified' ? ' btn--active' : ''}`}
        onClick={() => setView('unified')}
        title="Unified view"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="8" x2="21" y2="8" />
          <line x1="3" y1="16" x2="21" y2="16" />
        </svg>
      </button>
      <button
        className={`btn btn--sm btn--icon${view === 'split' ? ' btn--active' : ''}`}
        onClick={() => setView('split')}
        title="Split view"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="8" height="18" rx="1" />
          <rect x="13" y="3" width="8" height="18" rx="1" />
        </svg>
      </button>
    </div>
  );
}

export default function CenterPanel({
  data, selectedFile, diffText, findings, splitView, selectedFindingId, findingActions, rightPanelOpen,
  onSelectFinding, onFindingAction, onToggleSplit, onShowRightPanel, onHelpModal, onAskAI,
  annotations, onAddAnnotation, onFileDeselect,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('results');

  // Auto-switch to diff tab when a file is selected
  useEffect(() => {
    if (selectedFile) setActiveTab('diff');
  }, [selectedFile]);

  function handleResultsTabClick() {
    setActiveTab('results');
    onFileDeselect();
  }

  return (
    <div className="panel cp">
      <div className="tabbar" role="tablist">
        <button
          className={`tab${activeTab === 'results' ? ' tab--active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'results'}
          onClick={handleResultsTabClick}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          Code Review Results
        </button>
        <button
          className={`tab${activeTab === 'diff' ? ' tab--active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'diff'}
          onClick={() => setActiveTab('diff')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Code Diff
          {selectedFile !== null && <span className="tab__count">1</span>}
        </button>
        <span className="tabbar__spacer" />
        {activeTab === 'diff' && <DiffTools />}
      </div>
      <div className="cp__content">
        {activeTab === 'results' ? (
          <ResultsView
            data={data}
            selectedFindingId={selectedFindingId}
            findingActions={findingActions}
            onSelectFinding={onSelectFinding}
            onFindingAction={onFindingAction}
            onAskAI={onAskAI}
          />
        ) : (
          <DiffViewer
            file={selectedFile} diffText={diffText}
            findings={findings} splitView={splitView}
            selectedFindingId={selectedFindingId}
            findingActions={findingActions}
            onSelectFinding={onSelectFinding}
            onFindingAction={onFindingAction}
            onToggleSplit={onToggleSplit}
            rightPanelOpen={rightPanelOpen}
            onShowRightPanel={onShowRightPanel}
            onHelpModal={onHelpModal}
            onAskAI={onAskAI}
            annotations={annotations}
            onAddAnnotation={onAddAnnotation} />
        )}
      </div>
    </div>
  );
}

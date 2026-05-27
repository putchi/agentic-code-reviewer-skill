import { useState, useEffect } from 'react';
import type { Finding, ReviewData } from '@acr/shared';
import DiffViewer from '../DiffViewer/index';
import ResultsView from './ResultsView';

interface Props {
  data: ReviewData | null;
  selectedFile: string | null;
  diffText: string;
  findings: Finding[];
  splitView: boolean;
  rightPanelOpen: boolean;
  onToggleSplit: () => void;
  onShowRightPanel: () => void;
  onHelpModal: () => void;
  onAskAI: (prompt: string) => void;
  onFileDeselect: () => void;
}

type Tab = 'results' | 'diff';

export default function CenterPanel({
  data, selectedFile, diffText, findings, splitView, rightPanelOpen,
  onToggleSplit, onShowRightPanel, onHelpModal, onAskAI, onFileDeselect,
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="center-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          className={`center-tab${activeTab === 'results' ? ' center-tab-active' : ''}`}
          onClick={handleResultsTabClick}
          style={{
            padding: '8px 16px', fontSize: '13px', border: 'none', background: 'none',
            cursor: 'pointer', borderBottom: activeTab === 'results' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'results' ? 'var(--text)' : 'var(--text-dim)', fontWeight: activeTab === 'results' ? 600 : 400,
          }}>
          Code Review Results
        </button>
        <button
          className={`center-tab${activeTab === 'diff' ? ' center-tab-active' : ''}`}
          onClick={() => setActiveTab('diff')}
          style={{
            padding: '8px 16px', fontSize: '13px', border: 'none', background: 'none',
            cursor: 'pointer', borderBottom: activeTab === 'diff' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'diff' ? 'var(--text)' : 'var(--text-dim)', fontWeight: activeTab === 'diff' ? 600 : 400,
          }}>
          Code Diff
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'results' ? (
          <ResultsView data={data} />
        ) : (
          <DiffViewer
            file={selectedFile} diffText={diffText}
            findings={findings} splitView={splitView}
            onToggleSplit={onToggleSplit}
            rightPanelOpen={rightPanelOpen}
            onShowRightPanel={onShowRightPanel}
            onHelpModal={onHelpModal}
            onAskAI={onAskAI} />
        )}
      </div>
    </div>
  );
}

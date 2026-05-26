import { useState } from 'react';
import type { Finding, FileEntry } from '@acr/shared';
import FindingsList from './FindingsList';
import FilesList from './FilesList';

interface Props {
  findings: Finding[];
  files: FileEntry[];
  selectedFindingId: string | null;
  selectedFile: string | null;
  checkedIds: Set<string>;
  dismissedIds: Set<string>;
  onSelectFinding: (f: Finding) => void;
  onSelectFile: (path: string) => void;
  onToggleCheck: (id: string) => void;
  onRestoreFinding: (id: string) => void;
}

export default function LeftPanel({
  findings, files, selectedFindingId, selectedFile, checkedIds, dismissedIds,
  onSelectFinding, onSelectFile, onToggleCheck, onRestoreFinding,
}: Props) {
  const [tab, setTab] = useState<'findings'|'files'>('findings');
  return (
    <div className="left-panel">
      <div className="tabs">
        <div className={`tab${tab === 'findings' ? ' active' : ''}`} onClick={() => setTab('findings')}>Findings</div>
        <div className={`tab${tab === 'files' ? ' active' : ''}`} onClick={() => setTab('files')}>Files</div>
      </div>
      <div className="panel-scroll" style={{ display: tab === 'findings' ? '' : 'none' }}>
        <FindingsList findings={findings} selectedId={selectedFindingId}
          checkedIds={checkedIds} dismissedIds={dismissedIds}
          onSelect={onSelectFinding} onToggle={onToggleCheck} onRestore={onRestoreFinding} />
      </div>
      <div className="panel-scroll" style={{ display: tab === 'files' ? '' : 'none' }}>
        <FilesList files={files} findings={findings} selectedFile={selectedFile} onSelect={onSelectFile} />
      </div>
    </div>
  );
}

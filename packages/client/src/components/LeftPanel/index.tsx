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
  onSelectFinding: (f: Finding) => void;
  onSelectFile: (path: string) => void;
  onToggleCheck: (id: string) => void;
}

export default function LeftPanel({
  findings, files, selectedFindingId, selectedFile, checkedIds,
  onSelectFinding, onSelectFile, onToggleCheck,
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
          checkedIds={checkedIds} onSelect={onSelectFinding} onToggle={onToggleCheck} />
      </div>
      <div className="panel-scroll" style={{ display: tab === 'files' ? '' : 'none' }}>
        <FilesList files={files} findings={findings} selectedFile={selectedFile} onSelect={onSelectFile} />
      </div>
    </div>
  );
}

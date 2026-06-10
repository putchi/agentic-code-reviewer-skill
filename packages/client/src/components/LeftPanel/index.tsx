import { useState, useMemo } from 'react';
import type { Finding, FileEntry, FindingAction } from '@acr/shared';
import FindingsList from './FindingsList';
import FilesList from './FilesList';
import { ACTION_OPTIONS } from '../../lib/findingActions';

interface Props {
  findings: Finding[];
  files: FileEntry[];
  selectedFindingId: string | null;
  selectedFile: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelectFinding: (f: Finding) => void;
  onOpenFindingDiff: (f: Finding) => void;
  onSelectFile: (path: string) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onBatchAction: (action: FindingAction | 'clear') => void;
  onAskAI: (prompt: string) => void;
  batchDisabled?: boolean;
}

export default function LeftPanel({
  findings, files, selectedFindingId, selectedFile, findingActions,
  onSelectFinding, onOpenFindingDiff, onSelectFile, onFindingAction, onBatchAction, onAskAI, batchDisabled = false,
}: Props) {
  const [tab, setTab] = useState<'findings' | 'files'>('findings');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const filteredFindings = useMemo(() =>
    q
      ? findings.filter(f =>
          f.finding.toLowerCase().includes(q) || f.file.toLowerCase().includes(q)
        )
      : findings,
    [findings, q]
  );

  return (
    <div className="panel lp">
      <div className="lp__tabbar">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'findings'}
          onClick={() => setTab('findings')}
        >
          Findings <span className="tab__count">{findings.length}</span>
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'files'}
          onClick={() => setTab('files')}
        >
          Files <span className="tab__count">{files.length}</span>
        </button>
        <span className="lp__tabbar-spacer" />
        <label className="lp__batch" title="Apply action to all findings">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
          </svg>
          <select
            value=""
            disabled={batchDisabled}
            aria-label="Apply action to all findings"
            onChange={e => {
              const value = e.target.value;
              if (value) onBatchAction(value as FindingAction | 'clear');
            }}
          >
            <option value="">Batch</option>
            <option value="clear">No action</option>
            {ACTION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="lp__search">
        <div className="lp__search-wrap">
          <span className="lp__search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter…"
          />
        </div>
      </div>

      {tab === 'findings' ? (
        <div className="lp__list" role="listbox">
          <FindingsList
            findings={filteredFindings}
            selectedId={selectedFindingId}
            findingActions={findingActions}
            onSelect={onSelectFinding}
            onOpenFindingDiff={onOpenFindingDiff}
            onFindingAction={onFindingAction}
            onAskAI={onAskAI}
          />
        </div>
      ) : (
        <div className="lp__list" role="list">
          <FilesList
            files={files}
            query={query}
            selectedPath={selectedFile}
            onSelect={onSelectFile}
          />
        </div>
      )}
    </div>
  );
}

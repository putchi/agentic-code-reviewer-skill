import { useEffect, useRef, useState } from 'react';
import type { Finding } from '@acr/shared';
import { useReviewData } from './hooks/useReviewData';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAnnotations } from './hooks/useAnnotations';
import Header from './components/Header';
import FilterBar from './components/FilterBar';
import LeftPanel from './components/LeftPanel/index';
import DiffViewer from './components/DiffViewer/index';
import RightPanel from './components/RightPanel/index';
import ActionBar from './components/ActionBar';
import HelpModal from './components/modals/HelpModal';
import SettingsPopover from './components/modals/SettingsPopover';
import UpdateToast from './components/modals/UpdateToast';

export default function App() {
  const { data, isLoading, error } = useReviewData();
  const { annotations } = useAnnotations();
  const [activeFilter, setActiveFilter] = useState<'ALL'|'CRITICAL'|'HIGH'|'NOTE'>('ALL');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useLocalStorage('acr-right-panel', true);
  const [splitView, setSplitView] = useLocalStorage('acr-split-view', false);
  const [comments, setComments] = useLocalStorage<Record<string, string>>('acr-comments', {});
  const [checkedIds, setCheckedIds] = useLocalStorage<string[]>('acr-checked-ids', []);
  const [model, setModel] = useLocalStorage('acr-chat-model', 'claude-sonnet-4-6');
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chatPrefill, setChatPrefill] = useState('');
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const checkedSet = new Set(checkedIds);

  useEffect(() => {
    if (!data) return;
    // Pre-check CRITICAL findings on first load
    const key = 'acr-checked-initted';
    if (!localStorage.getItem(key)) {
      const critIds = data.findings.filter(f => f.severity === 'CRITICAL').map(f => f.id);
      if (critIds.length) setCheckedIds(critIds);
      localStorage.setItem(key, '1');
    }
  }, [data]);

  const findings = data?.findings ?? [];
  const files = data?.files ?? [];
  const counts = { CRITICAL: 0, HIGH: 0, NOTE: 0 };
  for (const f of findings) { if (f.severity in counts) counts[f.severity as keyof typeof counts]++; }
  const filtered = findings.filter(f => activeFilter === 'ALL' || f.severity === activeFilter);

  // Keyboard shortcuts (Task 23)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      if (e.key === 'Escape') { setShowHelp(false); setShowSettings(false); return; }
      if (e.key === 'j' || e.key === 'k') {
        const idx = filtered.findIndex(f => f.id === selectedFinding?.id);
        const next = e.key === 'j' ? idx + 1 : idx - 1;
        if (next >= 0 && next < filtered.length) {
          setSelectedFinding(filtered[next]);
          setSelectedFile(filtered[next].file);
        }
        return;
      }
      if (e.key === ' ' && selectedFinding) {
        e.preventDefault();
        toggleCheck(selectedFinding.id);
        return;
      }
      if (e.key === 'Enter' && selectedFinding) {
        setSelectedFile(selectedFinding.file);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedFinding]);

  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return Array.from(s);
    });
  }
  function selectAll() { setCheckedIds(findings.map(f => f.id)); }
  function deselectAll() { setCheckedIds([]); }

  function handleCommentChange(key: string, text: string) {
    setComments(prev => ({ ...prev, [key]: text }));
  }
  function handleGlobalChange(text: string) {
    setComments(prev => ({ ...prev, _global: text }));
  }

  const diffText = data?.files.find(f => f.path === selectedFile)?.diff ?? '';

  if (isLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-dim)' }}>
      Loading review data…
    </div>
  );
  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--red)' }}>
      Error: {error}
    </div>
  );

  return (
    <div className="app">
      <Header data={data}
        onSettings={() => setShowSettings(true)}
        onHelp={() => setShowHelp(true)} />
      <FilterBar activeFilter={activeFilter} counts={counts} onChange={setActiveFilter} />
      <div className="panels">
        <LeftPanel
          findings={filtered} files={files}
          selectedFindingId={selectedFinding?.id ?? null}
          selectedFile={selectedFile}
          checkedIds={checkedSet}
          onSelectFinding={f => { setSelectedFinding(f); setSelectedFile(f.file); }}
          onSelectFile={path => { setSelectedFile(path); setSelectedFinding(null); }}
          onToggleCheck={toggleCheck} />
        <div className="center-panel">
          <DiffViewer
            file={selectedFile} diffText={diffText}
            findings={findings} splitView={splitView as boolean}
            onToggleSplit={() => setSplitView(v => !v)}
            rightPanelOpen={rightPanelOpen as boolean}
            onShowRightPanel={() => setRightPanelOpen(true)}
            onHelpModal={() => setShowHelp(true)}
            onAskAI={prompt => { setChatPrefill(prompt); setRightPanelOpen(true); }} />
        </div>
        {rightPanelOpen && (
          <RightPanel
            findings={findings} checkedIds={checkedSet}
            comments={comments} globalComment={comments['_global'] || ''}
            model={model as string} currentFile={selectedFile ?? undefined}
            chatPrefill={chatPrefill}
            onChatPrefillConsumed={() => setChatPrefill('')}
            onCommentChange={handleCommentChange}
            onGlobalChange={handleGlobalChange}
            onClose={() => setRightPanelOpen(false)} />
        )}
      </div>
      <ActionBar
        findings={findings} checkedIds={checkedSet}
        comments={comments} globalComment={comments['_global'] || ''}
        lineAnnotations={annotations}
        onSelectAll={selectAll} onDeselectAll={deselectAll} />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showSettings && (
        <SettingsPopover model={model as string} anchorRef={settingsBtnRef}
          onModel={m => setModel(m)}
          onClose={() => setShowSettings(false)} />
      )}
      <UpdateToast />
    </div>
  );
}

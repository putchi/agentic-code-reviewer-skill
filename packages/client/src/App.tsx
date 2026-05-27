import { useEffect, useState } from 'react';
import type { Finding } from '@acr/shared';
import { useReviewData } from './hooks/useReviewData';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAnnotations } from './hooks/useAnnotations';
import { useSettings } from './hooks/useSettings';
import { postDecision } from './lib/api';
import { buildDecisionPayload } from '@acr/shared';
import Header from './components/Header';
import FilterBar from './components/FilterBar';
import LeftPanel from './components/LeftPanel/index';
import DiffViewer from './components/DiffViewer/index';
import RightPanel from './components/RightPanel/index';
import ActionBar from './components/ActionBar';
import CloseGuardModal from './components/ActionBar/CloseGuardModal';
import HelpModal from './components/modals/HelpModal';
import SettingsPane from './components/modals/SettingsPane';
import FirstRunModal from './components/modals/FirstRunModal';
import UpdateToast from './components/modals/UpdateToast';

export default function App() {
  const { data, isLoading: reviewLoading, error } = useReviewData();
  const { settings, updateSettings, isLoading: settingsLoading } = useSettings();
  const { annotations } = useAnnotations();
  const isLoading = reviewLoading || settingsLoading;
  const [activeFilter, setActiveFilter] = useState<'ALL'|'CRITICAL'|'HIGH'|'NOTE'>('ALL');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useLocalStorage('acr-right-panel', true);
  const [splitView, setSplitView] = useLocalStorage('acr-split-view', false);
  const [comments, setComments] = useLocalStorage<Record<string, string>>('acr-comments', {});
  const [checkedIds, setCheckedIds] = useLocalStorage<string[]>('acr-checked-ids', []);
  const [dismissedIds, setDismissedIds] = useLocalStorage<string[]>('acr-dismissed-ids', []);
  const [dismissReasons, setDismissReasons] = useLocalStorage<Record<string, string>>('acr-dismiss-reasons', {});
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCloseGuard, setShowCloseGuard] = useState(false);
  const [chatPrefill, setChatPrefill] = useState('');

  const checkedSet = new Set(checkedIds);
  const dismissedSet = new Set(dismissedIds);

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
  const unaddressedCriticals = findings.filter(
    f => f.severity === 'CRITICAL' && !checkedSet.has(f.id) && !dismissedSet.has(f.id)
  );

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (unaddressedCriticals.length > 0) e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unaddressedCriticals.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      if (e.key === 'Escape') { setShowHelp(false); setShowMenu(false); return; }
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

  function dismissFindings(ids: string[], reason: string) {
    const idSet = new Set(ids);
    setDismissedIds(prev => Array.from(new Set([...prev, ...ids])));
    setDismissReasons(prev => {
      const next = { ...prev };
      for (const id of ids) {
        if (reason) next[id] = reason;
        else delete next[id];
      }
      return next;
    });
    setCheckedIds(prev => prev.filter(id => !idSet.has(id)));
  }

  function restoreFinding(id: string) {
    setDismissedIds(prev => prev.filter(x => x !== id));
    setDismissReasons(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function buildBasePayload() {
    return buildDecisionPayload({
      checkedIds: checkedSet,
      comments,
      lineAnnotations: annotations,
      dismissedIds: dismissedSet,
      dismissReasons,
    });
  }

  async function handleCloseRequest() {
    if (unaddressedCriticals.length > 0) {
      setShowCloseGuard(true);
    } else {
      await postDecision('done', buildBasePayload());
      window.close();
    }
  }

  async function handleCloseGuardSave() {
    setShowCloseGuard(false);
    await postDecision('save', buildBasePayload());
    window.close();
  }

  async function handleCloseGuardAnyway() {
    setShowCloseGuard(false);
    await postDecision('done', buildBasePayload());
    window.close();
  }

  function handleCommentChange(key: string, text: string) {
    setComments(prev => ({ ...prev, [key]: text }));
  }
  function handleGlobalChange(text: string) {
    setComments(prev => ({ ...prev, _global: text }));
  }

  const diffText = (data?.files ?? []).find(f => f.path === selectedFile)?.diff ?? '';

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
      <Header
        data={data}
        onMenu={() => setShowMenu(true)}
        globalComment={comments['_global'] || ''}
        onGlobalChange={handleGlobalChange}
        onAskAI={prompt => { setChatPrefill(prompt); setRightPanelOpen(true); }}
      />
      <FilterBar activeFilter={activeFilter} counts={counts} onChange={setActiveFilter} />
      <div className="panels">
        <LeftPanel
          findings={filtered} files={files}
          selectedFindingId={selectedFinding?.id ?? null}
          selectedFile={selectedFile}
          checkedIds={checkedSet}
          dismissedIds={dismissedSet}
          onSelectFinding={f => { setSelectedFinding(f); setSelectedFile(f.file); }}
          onSelectFile={path => { setSelectedFile(path); setSelectedFinding(null); }}
          onToggleCheck={toggleCheck}
          onRestoreFinding={restoreFinding} />
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
            model={settings.chatModel} currentFile={selectedFile ?? undefined}
            chatPrefill={chatPrefill}
            onChatPrefillConsumed={() => setChatPrefill('')}
            onCommentChange={handleCommentChange}
            onGlobalChange={handleGlobalChange}
            onClose={() => setRightPanelOpen(false)} />
        )}
      </div>
      <ActionBar
        checkedIds={checkedSet}
        comments={comments}
        lineAnnotations={annotations}
        autoCloseMs={settings.autoCloseMs}
        dismissedIds={dismissedSet} dismissReasons={dismissReasons}
        onSelectAll={selectAll} onDeselectAll={deselectAll}
        onDismiss={dismissFindings}
        onCloseRequest={handleCloseRequest} />
      {!isLoading && !settings.firstRunDone && (
        <FirstRunModal settings={settings} onSave={patch => updateSettings(patch)} />
      )}
      {showCloseGuard && (
        <CloseGuardModal
          criticalFindings={unaddressedCriticals}
          onSaveAndClose={handleCloseGuardSave}
          onCloseAnyway={handleCloseGuardAnyway}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <SettingsPane
        open={showMenu}
        settings={settings}
        onUpdate={patch => updateSettings(patch)}
        onClose={() => setShowMenu(false)}
        onHelp={() => setShowHelp(true)} />
      <UpdateToast />
    </div>
  );
}

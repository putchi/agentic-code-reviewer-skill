import { useEffect, useState } from 'react';
import type { Finding, FindingAction } from '@acr/shared';
import { useReviewData } from './hooks/useReviewData';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAnnotations, type Selection } from './hooks/useAnnotations';
import { useSettings } from './hooks/useSettings';
import { postDecision } from './lib/api';
import { buildDecisionPayload } from '@acr/shared';
import type { LineAnnotation } from '@acr/shared';
import Header from './components/Header';
import FilterBar from './components/FilterBar';
import LeftPanel from './components/LeftPanel/index';
import CenterPanel from './components/CenterPanel/index';
import RightPanel from './components/RightPanel/index';
import ActionBar from './components/ActionBar';
import CloseGuardModal from './components/ActionBar/CloseGuardModal';
import DismissModal from './components/ActionBar/DismissModal';
import HelpModal from './components/modals/HelpModal';
import SettingsPane from './components/modals/SettingsPane';
import FirstRunModal from './components/modals/FirstRunModal';
import UpdateToast from './components/modals/UpdateToast';
import { isImplementAction } from './lib/findingActions';

export default function App() {
  const { data, isLoading: reviewLoading, error } = useReviewData();
  const { settings, updateSettings, isLoading: settingsLoading } = useSettings();
  const { annotations, addAnnotation, removeAnnotation, clearAnnotations } = useAnnotations();
  const isLoading = reviewLoading || settingsLoading;
  const [activeFilter, setActiveFilter] = useState<'ALL'|'CRITICAL'|'HIGH'|'NOTE'>('ALL');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [splitView, setSplitView] = useLocalStorage('acr-split-view', false);
  const [comments, setComments] = useLocalStorage<Record<string, string>>('acr-comments', {});
  const [findingActions, setFindingActions] = useLocalStorage<Record<string, FindingAction | ''>>('acr-finding-actions', {});
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCloseGuard, setShowCloseGuard] = useState(false);
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [dismissScope, setDismissScope] = useState<'selected' | 'all'>('selected');
  const [finalizing, setFinalizing] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<{ id: number; prompt: string } | null>(null);
  const [commentsFocusToken, setCommentsFocusToken] = useState(0);

  const findings = data?.findings ?? [];
  const files = data?.files ?? [];

  useEffect(() => {
    if (!data?.runId) return;
    const key = 'acr-current-run-id';
    if (localStorage.getItem(key) === data.runId) return;
    setFindingActions({});
    setComments({});
    clearAnnotations();
    localStorage.setItem(key, data.runId);
  }, [data?.runId, clearAnnotations]);

  const counts = { CRITICAL: 0, HIGH: 0, NOTE: 0 };
  for (const f of findings) { if (f.severity in counts) counts[f.severity as keyof typeof counts]++; }
  const filtered = findings.filter(f => activeFilter === 'ALL' || f.severity === activeFilter);
  const unaddressedCriticals = findings.filter(
    f => f.severity === 'CRITICAL' && !findingActions[f.id]
  );
  const implementationSelectedIds = findings
    .filter(f => isImplementAction(findingActions[f.id]))
    .map(f => f.id);
  const dismissTargetIds = dismissScope === 'selected' && implementationSelectedIds.length
    ? implementationSelectedIds
    : findings.map(f => f.id);
  const dismissCount = dismissTargetIds.length;

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
        const action = findingActions[selectedFinding.id];
        setFindingAction(selectedFinding.id, isImplementAction(action) ? '' : 'ask_claude_to_implement');
        return;
      }
      if (e.key === 'Enter' && selectedFinding) {
        setSelectedFile(selectedFinding.file);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedFinding, findingActions]);

  function setFindingAction(id: string, action: FindingAction | '') {
    setFindingActions(prev => {
      const next = { ...prev };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }

  function buildBasePayload() {
    return buildDecisionPayload({
      runId: data?.runId,
      findingActions,
      comments,
      lineAnnotations: annotations,
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
  }

  async function handleCloseGuardAnyway() {
    setShowCloseGuard(false);
    await postDecision('done', buildBasePayload());
    window.close();
  }

  function handleSelectAllForImplementation() {
    setFindingActions(prev => {
      const next = { ...prev };
      for (const f of findings) next[f.id] = 'ask_claude_to_implement';
      return next;
    });
  }

  function handleClearImplementationSelection() {
    setFindingActions(prev => {
      const next = { ...prev };
      for (const f of findings) {
        if (isImplementAction(next[f.id])) delete next[f.id];
      }
      return next;
    });
  }

  function handleBatchAction(action: FindingAction | 'clear') {
    if (action === 'ignore') {
      setDismissScope('all');
      setShowDismissModal(true);
      return;
    }
    setFindingActions(prev => {
      const next = { ...prev };
      for (const f of findings) {
        if (action === 'clear') delete next[f.id];
        else next[f.id] = action;
      }
      return next;
    });
  }

  function openDismissModal() {
    setDismissScope(implementationSelectedIds.length ? 'selected' : 'all');
    setShowDismissModal(true);
  }

  async function handleImplementSelected() {
    if (implementationSelectedIds.length === 0) return;
    setFinalizing(true);
    try {
      await postDecision('implement', buildBasePayload());
      window.close();
    } finally {
      setFinalizing(false);
    }
  }

  async function handleDismissConfirm(reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) return;
    const targetIds = dismissTargetIds;
    const nextActions = { ...findingActions };
    const nextComments = { ...comments };
    for (const id of targetIds) {
      nextActions[id] = 'ignore';
      nextComments[id] = trimmed;
    }

    setShowDismissModal(false);
    setFindingActions(nextActions);
    setComments(nextComments);
    setFinalizing(true);
    try {
      await postDecision('implement', buildDecisionPayload({
        runId: data?.runId,
        findingActions: nextActions,
        comments: nextComments,
        lineAnnotations: annotations,
      }));
      window.close();
    } finally {
      setFinalizing(false);
    }
  }

  function handleCommentChange(key: string, text: string) {
    setComments(prev => ({ ...prev, [key]: text }));
  }
  function handleGlobalChange(text: string) {
    setComments(prev => ({ ...prev, _global: text }));
  }
  function handleAddAnnotation(sel: Selection, type: LineAnnotation['type'], text: string) {
    addAnnotation(sel, type, text);
    setRightPanelOpen(true);
    setCommentsFocusToken(Date.now());
  }

  const diffText = (data?.files ?? []).find(f => f.path === selectedFile)?.diff ?? '';

  if (isLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--fg-muted)' }}>
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
        onAskAI={prompt => { setChatPrefill({ id: Date.now(), prompt }); setRightPanelOpen(true); }}
      />
      <FilterBar activeFilter={activeFilter} counts={counts} onChange={setActiveFilter} />
      <div className="app__body">
        <LeftPanel
          findings={filtered} files={files}
          selectedFindingId={selectedFinding?.id ?? null}
          selectedFile={selectedFile}
          findingActions={findingActions}
          onSelectFinding={f => { setSelectedFinding(f); setSelectedFile(f.file); }}
          onSelectFile={path => { setSelectedFile(path); setSelectedFinding(null); }}
          onFindingAction={setFindingAction}
          onBatchAction={handleBatchAction}
          batchDisabled={finalizing || findings.length === 0} />
        <CenterPanel
          data={data ?? null}
          selectedFile={selectedFile} diffText={diffText}
          findings={findings} splitView={splitView as boolean}
          selectedFindingId={selectedFinding?.id ?? null}
          findingActions={findingActions}
          onSelectFinding={f => { setSelectedFinding(f); setSelectedFile(f.file); }}
          onFindingAction={setFindingAction}
          onToggleSplit={() => setSplitView(v => !v)}
          rightPanelOpen={rightPanelOpen as boolean}
          onShowRightPanel={() => setRightPanelOpen(true)}
          onHelpModal={() => setShowHelp(true)}
          onAskAI={prompt => { setChatPrefill({ id: Date.now(), prompt }); setRightPanelOpen(true); }}
          annotations={annotations}
          onAddAnnotation={handleAddAnnotation}
          onFileDeselect={() => setSelectedFile(null)} />
        {rightPanelOpen && (
          <RightPanel
            findings={findings}
            findingActions={findingActions}
            comments={comments}
            model={settings.chatModel}
            currentFile={selectedFile ?? undefined}
            chatPrefill={chatPrefill}
            commentsFocusToken={commentsFocusToken}
            annotations={annotations}
            onCommentChange={handleCommentChange}
            onRemoveAnnotation={removeAnnotation}
            onClose={() => setRightPanelOpen(false)} />
        )}
        {!rightPanelOpen && (
          <button
            className="btn btn--sm btn--icon btn--ghost"
            style={{ position: 'fixed', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 100 }}
            onClick={() => setRightPanelOpen(true)}
            title="Open panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
      </div>
      <ActionBar
        runId={data?.runId}
        totalFindings={findings.length}
        findingActions={findingActions}
        comments={comments}
        lineAnnotations={annotations}
        resumeCommand={data?.resumeCommand}
        onCloseRequest={handleCloseRequest}
        onSelectAll={handleSelectAllForImplementation}
        onClearSelection={handleClearImplementationSelection}
        onImplement={handleImplementSelected}
        onDismiss={openDismissModal}
        finalizing={finalizing} />
      {showDismissModal && (
        <DismissModal
          count={dismissCount}
          scope={dismissScope === 'selected' && implementationSelectedIds.length > 0 ? 'selected' : 'all'}
          onConfirm={handleDismissConfirm}
          onCancel={() => setShowDismissModal(false)}
        />
      )}
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

import { useEffect, useMemo, useState } from 'react';
import type { Finding, FindingAction } from '@acr/shared';
import { useReviewData } from './hooks/useReviewData';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAnnotations, type Selection } from './hooks/useAnnotations';
import { useEditorAnnotations } from './hooks/useEditorAnnotations';
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
  const { settings, updateSettings, resetSettings, isLoading: settingsLoading } = useSettings();
  const { annotations, addAnnotation, removeAnnotation, clearAnnotations } = useAnnotations();
  const { editorAnnotations, deleteEditorAnnotation } = useEditorAnnotations();
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
  const [reviewDone, setReviewDone] = useState(false);

  const findings = data?.findings ?? [];
  const files = data?.files ?? [];
  const editorAnnotationMap = useMemo(() => {
    const entries: Record<string, LineAnnotation> = {};
    const idsByKey: Record<string, string> = {};
    for (const annotation of editorAnnotations) {
      const key = `${annotation.filePath}|${annotation.lineStart}|${annotation.lineEnd}|new`;
      entries[key] = {
        file: annotation.filePath,
        lineStart: annotation.lineStart,
        lineEnd: annotation.lineEnd,
        side: 'new',
        type: 'COMMENT',
        text: annotation.comment || '(no comment)',
        linesText: annotation.selectedText,
      };
      idsByKey[key] = annotation.id;
    }
    return { entries, idsByKey };
  }, [editorAnnotations]);
  const allAnnotations = useMemo(
    () => ({ ...annotations, ...editorAnnotationMap.entries }),
    [annotations, editorAnnotationMap],
  );

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
      lineAnnotations: allAnnotations,
    });
  }

  function reportAutoResumeFailure(result: Awaited<ReturnType<typeof postDecision>>) {
    const autoResume = result.autoResume;
    if (!autoResume || autoResume.started || autoResume.reason === 'disabled') return;
    const fallback = autoResume.fallbackCommand ? `\n\nManual fallback:\n${autoResume.fallbackCommand}` : '';
    window.alert(`Agentic Code Reviewer could not resume the host agent automatically (${autoResume.reason || 'unknown reason'}).${fallback}`);
  }

  function closeTab() {
    setReviewDone(true);
    window.close();
  }

  async function handleCloseRequest() {
    if (unaddressedCriticals.length > 0) {
      setShowCloseGuard(true);
    } else {
      reportAutoResumeFailure(await postDecision('done', buildBasePayload()));
      closeTab();
    }
  }

  async function handleCloseGuardSave() {
    setShowCloseGuard(false);
    await postDecision('save', buildBasePayload());
  }

  async function handleCloseGuardAnyway() {
    setShowCloseGuard(false);
    reportAutoResumeFailure(await postDecision('done', buildBasePayload()));
    closeTab();
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
      reportAutoResumeFailure(await postDecision('implement', buildBasePayload()));
      closeTab();
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
      reportAutoResumeFailure(await postDecision('implement', buildDecisionPayload({
        runId: data?.runId,
        findingActions: nextActions,
        comments: nextComments,
        lineAnnotations: allAnnotations,
      })));
      closeTab();
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
  function handleRemoveAnnotation(key: string) {
    const editorAnnotationId = editorAnnotationMap.idsByKey[key];
    if (editorAnnotationId) {
      void deleteEditorAnnotation(editorAnnotationId);
      return;
    }
    removeAnnotation(key);
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
          onSelectFinding={f => setSelectedFinding(prev => prev?.id === f.id ? null : f)}
          onOpenFindingDiff={f => { setSelectedFinding(f); setSelectedFile(f.file); }}
          onSelectFile={path => { setSelectedFile(path); setSelectedFinding(null); }}
          onFindingAction={setFindingAction}
          onBatchAction={handleBatchAction}
          onAskAI={prompt => { setChatPrefill({ id: Date.now(), prompt }); setRightPanelOpen(true); }}
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
          annotations={allAnnotations}
          onAddAnnotation={handleAddAnnotation}
          onFileDeselect={() => setSelectedFile(null)} />
        {rightPanelOpen && (
          <RightPanel
            findings={findings}
            findingActions={findingActions}
            comments={comments}
            settings={settings}
            currentFile={selectedFile ?? undefined}
            chatPrefill={chatPrefill}
            commentsFocusToken={commentsFocusToken}
            annotations={allAnnotations}
            onCommentChange={handleCommentChange}
            onRemoveAnnotation={handleRemoveAnnotation}
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
        lineAnnotations={allAnnotations}
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
        <FirstRunModal
          settings={settings}
          onSave={patch => updateSettings(patch)}
          onReset={resetSettings}
        />
      )}
      {showCloseGuard && (
        <CloseGuardModal
          criticalFindings={unaddressedCriticals}
          onSaveAndClose={handleCloseGuardSave}
          onCloseAnyway={handleCloseGuardAnyway}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {reviewDone && (
        <div className="review-done-overlay">
          <div className="review-done-card">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--status-ok-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <p className="review-done-title">Review decisions saved.</p>
            <p className="review-done-hint">You can close this tab.</p>
          </div>
        </div>
      )}
      <SettingsPane
        open={showMenu}
        settings={settings}
        onUpdate={patch => updateSettings(patch)}
        onReset={resetSettings}
        onClose={() => setShowMenu(false)}
        onHelp={() => setShowHelp(true)} />
      <UpdateToast />
    </div>
  );
}

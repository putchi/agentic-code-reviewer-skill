import { useState, useEffect } from 'react';
import type { Finding, FindingAction } from '@acr/shared';
import CommentsPanel from './CommentsPanel';
import ChatPanel from './ChatPanel';

interface Props {
  findings: Finding[];
  findingActions: Record<string, FindingAction | ''>;
  comments: Record<string, string>;
  model: string;
  currentFile?: string;
  chatPrefill?: { id: number; prompt: string } | null;
  onCommentChange: (id: string, text: string) => void;
  onClose: () => void;
}

export default function RightPanel({
  findings, findingActions, comments, model,
  currentFile, chatPrefill,
  onCommentChange, onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'comments' | 'chat'>('chat');
  const decided = findings.filter(f => findingActions[f.id]);

  useEffect(() => {
    if (chatPrefill) setActiveTab('chat');
  }, [chatPrefill?.id]);

  return (
    <div className="panel rp">
      <div className="tabbar rp__head" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={activeTab === 'comments'}
          onClick={() => setActiveTab('comments')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Comments
          <span className="tab__count">{decided.length}</span>
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={activeTab === 'chat'}
          onClick={() => setActiveTab('chat')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.5 5H18l-4.5 3.5L15 17l-3-2.5L9 17l1.5-5.5L6 8h4.5z"/>
          </svg>
          Ask AI
        </button>
        <span className="tabbar__spacer" />
        <button
          className="btn btn--sm btn--icon btn--ghost"
          title="Collapse panel"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      {activeTab === 'comments' && (
        <CommentsPanel
          findings={findings}
          findingActions={findingActions}
          comments={comments}
          onCommentChange={onCommentChange}
        />
      )}
      {activeTab === 'chat' && (
        <ChatPanel
          model={model}
          currentFile={currentFile}
          prefillTrigger={chatPrefill}
        />
      )}
    </div>
  );
}

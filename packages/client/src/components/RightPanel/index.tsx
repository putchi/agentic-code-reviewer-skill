import { useState, useEffect } from 'react';
import type { Finding } from '@acr/shared';
import CommentsPanel from './CommentsPanel';
import ChatPanel from './ChatPanel';

interface Props {
  findings: Finding[];
  checkedIds: Set<string>;
  comments: Record<string, string>;
  globalComment: string;
  model: string;
  currentFile?: string;
  chatPrefill?: string;
  onChatPrefillConsumed?: () => void;
  onCommentChange: (id: string, text: string) => void;
  onGlobalChange: (text: string) => void;
  onClose: () => void;
}

export default function RightPanel({
  findings, checkedIds, comments, globalComment, model,
  currentFile, chatPrefill, onChatPrefillConsumed,
  onCommentChange, onGlobalChange, onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'comments' | 'chat'>('chat');
  const checked = findings.filter(f => checkedIds.has(f.id));

  // Auto-switch to chat when a prefill arrives
  useEffect(() => {
    if (chatPrefill) setActiveTab('chat');
  }, [chatPrefill]);

  return (
    <div className="right-panel">
      <div className="right-section">
        <button className="right-panel-close" title="Hide panel" onClick={onClose}>✕</button>
      </div>
      <div className="right-tab-bar">
        <button className={`right-tab${activeTab === 'comments' ? ' active' : ''}`}
          onClick={() => setActiveTab('comments')}>
          💬 Comments ({checked.length})
        </button>
        <button className={`right-tab${activeTab === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}>
          ✨ Ask AI
        </button>
      </div>
      {activeTab === 'comments' && (
        <CommentsPanel findings={findings} checkedIds={checkedIds}
          comments={comments}
          onCommentChange={onCommentChange} />
      )}
      {activeTab === 'chat' && (
        <ChatPanel model={model} currentFile={currentFile}
          prefillPrompt={chatPrefill} onPrefillConsumed={onChatPrefillConsumed} />
      )}
    </div>
  );
}

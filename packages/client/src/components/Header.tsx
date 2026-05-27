import { useRef, useState } from 'react';
import type { ReviewData } from '@acr/shared';
import GlobalCommentPopover from './GlobalCommentPopover';

interface Props {
  data: ReviewData | null;
  onMenu: () => void;
  globalComment?: string;
  onGlobalChange?: (text: string) => void;
  onAskAI?: (text: string) => void;
}

export default function Header({ data, onMenu, globalComment = '', onGlobalChange, onAskAI }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const commentBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="header" style={{ position: 'relative' }}>
      <div>
        <div className="header-title">Agentic Code Review</div>
        <div className="header-meta">
          {data ? `${data.branch} · ${data.timestamp?.slice(0, 10)}` : 'Loading…'}
        </div>
      </div>
      <div className="verdict-block">
        <div className="verdict-label">Verdict</div>
        <div className="verdict-text">{data?.verdict || 'Loading…'}</div>
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          ref={commentBtnRef}
          className="settings-btn"
          title={globalComment ? 'Edit global comment' : 'Add global comment'}
          onClick={() => setShowPopover(v => !v)}
          style={globalComment ? { color: 'var(--blue)' } : undefined}
        >✎</button>
        <button className="settings-btn" title="Menu" onClick={onMenu}>≡</button>
      </div>
      {showPopover && (
        <GlobalCommentPopover
          value={globalComment}
          onSave={text => onGlobalChange?.(text)}
          onClose={() => setShowPopover(false)}
          anchorRef={commentBtnRef}
          onAskAI={onAskAI}
        />
      )}
    </div>
  );
}

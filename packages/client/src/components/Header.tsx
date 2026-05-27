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

  const verdictLabel = data?.verdict
    ? data.verdict.toLowerCase().includes('critical') ? 'Critical'
      : data.verdict.toLowerCase().includes('high') ? 'High'
      : 'Review'
    : 'Loading';

  const branch = data?.branch ?? '';
  const date = data?.timestamp?.slice(0, 10) ?? '';

  return (
    <header className="hdr" style={{ position: 'relative' }}>
      <div className="hdr__brand">
        <div className="hdr__mark">
          {/* cursor icon SVG */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1l9 5-4.5 1.5L6 12z"/>
          </svg>
        </div>
        <div className="hdr__title-wrap">
          <div className="hdr__title">Agentic Code Review</div>
          <div className="hdr__meta">
            {/* git-branch icon */}
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="5" cy="3" r="1.5"/>
              <circle cx="5" cy="13" r="1.5"/>
              <circle cx="11" cy="5" r="1.5"/>
              <path d="M5 4.5V11.5"/>
              <path d="M5 4.5C5 7 11 6.5 11 6.5"/>
            </svg>
            <span>{branch}</span>
            {date && <><span className="dot" /><span>{date}</span></>}
          </div>
        </div>
      </div>

      <div className="hdr__verdict">
        <span className="hdr__verdict-badge">
          <span className="dot" />
          {verdictLabel}
        </span>
        <span className="hdr__verdict-text" title={data?.verdict ?? ''}>
          {data?.verdict ?? 'Loading…'}
        </span>
      </div>

      <div className="hdr__actions">
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => onAskAI?.('Summarize this code review and tell me what to prioritize.')}
          title="Ask AI about this review"
        >
          {/* sparkles icon */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.22 4.22l1.42 1.42M10.36 10.36l1.42 1.42M4.22 11.78l1.42-1.42M10.36 5.64l1.42-1.42"/>
          </svg>
          Ask AI
        </button>
        <button
          ref={commentBtnRef}
          className="btn btn--sm btn--icon btn--ghost"
          title={globalComment ? 'Edit global comment' : 'Add global comment'}
          onClick={() => setShowPopover(v => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 2l3 3-8 8H3v-3z"/>
          </svg>
        </button>
        <button className="btn btn--sm btn--icon btn--ghost" title="Menu" onClick={onMenu}>
          {/* menu icon — 3 lines */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h12"/>
          </svg>
        </button>
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
    </header>
  );
}

import { useState } from 'react';

interface Props { onClose: () => void; }

export default function HelpModal({ onClose }: Props) {
  const [tab, setTab] = useState<'modes'|'actions'>('modes');
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">How to use Agentic Code Review</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <div className={`modal-tab${tab === 'modes' ? ' active' : ''}`} onClick={() => setTab('modes')}>Annotation Modes</div>
          <div className={`modal-tab${tab === 'actions' ? ' active' : ''}`} onClick={() => setTab('actions')}>What Happens</div>
        </div>
        <div className="modal-body">
          {tab === 'modes' ? (
            <>
              <h3>Select (default)</h3>
              <p>Drag to select lines in the diff. A mini-toolbar appears with options: Comment, Ask AI, Copy, Redline.</p>
              <h3>Pinpoint</h3>
              <p>Click a single line to target it directly without dragging.</p>
              <h3>Comment</h3>
              <p>Drag to select lines — the comment popover opens immediately.</p>
              <h3>Redline</h3>
              <p>Drag to mark lines for deletion — saved instantly as a redline annotation.</p>
              <h3>Label</h3>
              <p>Drag to select lines — a quick-label picker appears with preset labels.</p>
              <h3>Keyboard shortcuts</h3>
              <ul>
                <li><code>j</code> / <code>k</code> — next / previous finding</li>
                <li><code>Space</code> — toggle checkbox on active finding</li>
                <li><code>Enter</code> — view diff for active finding</li>
                <li><code>Escape</code> — close any open popover / modal</li>
              </ul>
            </>
          ) : (
            <>
              <h3>Implement</h3>
              <p>Writes selected findings and comments to the decision file, then closes the server. Claude Code reads the decision and proceeds with implementation.</p>
              <h3>Save</h3>
              <p>Saves a Markdown review summary to <code>docs/code-reviews/</code>. Keeps the server running.</p>
              <h3>Done</h3>
              <p>Closes the review without implementing. Writes the decision file and exits.</p>
              <h3>Chat</h3>
              <p>Ask Claude about the diff. Uses the current model (configurable in Settings). The system prompt includes the full diff and all findings.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

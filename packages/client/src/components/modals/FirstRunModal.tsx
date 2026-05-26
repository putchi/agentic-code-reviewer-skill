import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Settings } from '../../lib/api';

interface Props {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
}

const MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Balanced — fast and capable (default)' },
  { value: 'claude-opus-4-7',   label: 'Opus 4.7',   desc: 'Most capable, slower' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fastest, lightest' },
];

export default function FirstRunModal({ settings, onSave }: Props) {
  const [chatModel, setChatModel] = useState(settings.chatModel);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(settings.autoCloseMs > 0);
  const [autoCloseSec, setAutoCloseSec] = useState(Math.max(settings.autoCloseMs / 1000, 3));

  function handleSave() {
    onSave({
      chatModel,
      autoCloseMs: autoCloseEnabled ? autoCloseSec * 1000 : 0,
      firstRunDone: true,
    });
  }

  return createPortal(
    <div className="first-run-backdrop">
      <div className="first-run-card">
        <div className="first-run-header">
          <div className="first-run-title">Welcome to Agentic Code Reviewer</div>
          <div className="first-run-subtitle">These are your default settings — confirm or adjust before your first review.</div>
        </div>
        <div className="first-run-body">
          <div className="first-run-left">
            <div className="first-run-section">
              <div className="first-run-label">Chat model</div>
              <div className="first-run-desc">AI model used in the Ask AI chat panel</div>
              {MODELS.map(m => (
                <label key={m.value} className="first-run-radio">
                  <input type="radio" name="chatModel" value={m.value}
                    checked={chatModel === m.value}
                    onChange={() => setChatModel(m.value)} />
                  <span className="first-run-radio-label">{m.label}</span>
                  <span className="first-run-radio-desc">{m.desc}</span>
                </label>
              ))}
            </div>
            <div className="first-run-section">
              <div className="first-run-label">Auto-close tab</div>
              <div className="first-run-desc">Automatically close the browser tab after an action completes</div>
              <label className="first-run-toggle">
                <input type="checkbox" checked={autoCloseEnabled}
                  onChange={e => setAutoCloseEnabled(e.target.checked)} />
                <span>Enable auto-close</span>
              </label>
              {autoCloseEnabled && (
                <div className="first-run-delay">
                  <label>
                    Delay (seconds):
                    <input type="number" min={1} max={60} value={autoCloseSec}
                      onChange={e => setAutoCloseSec(Number(e.target.value))}
                      className="first-run-number" />
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="first-run-right">
            <div className="first-run-hint">
              <div className="first-run-hint-title">Find settings later</div>
              <div className="first-run-hint-body">
                Use the <strong>≡</strong> menu in the top bar to access these settings at any time.
              </div>
            </div>
          </div>
        </div>
        <div className="first-run-footer">
          <div className="first-run-footer-note">You can change these anytime via the ≡ menu in the top bar.</div>
          <button className="first-run-btn" onClick={handleSave}>Save &amp; Continue</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

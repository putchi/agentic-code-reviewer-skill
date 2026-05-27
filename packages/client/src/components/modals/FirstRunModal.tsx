import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Settings } from '../../lib/api';
import { ToggleSwitch } from '../atoms';

interface Props {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
}

const MODELS = [
  {
    value: 'claude-sonnet-4-6',
    title: 'Claude Sonnet 4.6',
    sub: 'Balanced — fast and capable',
    tag: 'default',
  },
  {
    value: 'claude-opus-4-7',
    title: 'Claude Opus 4.7',
    sub: 'Most capable, slower',
    tag: null,
  },
  {
    value: 'claude-haiku-4-5-20251001',
    title: 'Claude Haiku 4.5',
    sub: 'Fastest, lightest',
    tag: null,
  },
];

export default function FirstRunModal({ settings, onSave }: Props) {
  const [chatModel, setChatModel] = useState(settings.chatModel);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(settings.autoCloseMs > 0);
  const [autoCloseSec, setAutoCloseSec] = useState(
    Math.max(Math.round(settings.autoCloseMs / 1000) || 5, 1)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    if (saving || saved) return;
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => {
        onSave({
          chatModel,
          autoCloseMs: autoCloseEnabled ? autoCloseSec * 1000 : 0,
          firstRunDone: true,
        });
      }, 700);
    }, 280);
  }

  function handleSkip() {
    onSave({ firstRunDone: true });
  }

  function clampSec(val: number) {
    return Math.min(60, Math.max(1, val));
  }

  return createPortal(
    <div className="modal__scrim">
      <div className="modal">
        <div className="modal__head">
          <div className="modal__eyebrow">Welcome — first-run setup</div>
          <div className="modal__title">Agentic Code Reviewer</div>
          <div className="modal__sub">
            These are your default settings — confirm or adjust before your first review.
          </div>
        </div>

        <div className="modal__body">
          <div className="modal__main">
            <section>
              <div className="modal__section-label">Chat model</div>
              <div className="modal__radiogroup">
                {MODELS.map(m => (
                  <div
                    key={m.value}
                    className="radiocard"
                    data-checked={chatModel === m.value ? '' : undefined}
                    onClick={() => setChatModel(m.value)}
                    role="radio"
                    aria-checked={chatModel === m.value}
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') setChatModel(m.value); }}
                  >
                    <div className="radiocard__title">{m.title}</div>
                    <div className="radiocard__sub">{m.sub}</div>
                    {m.tag && <div className="radiocard__tag">{m.tag}</div>}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="modal__section-label">Auto-close</div>
              <div className="toggle-row">
                <ToggleSwitch
                  on={autoCloseEnabled}
                  onChange={setAutoCloseEnabled}
                />
                <span className="toggle-row__label">Auto-close tab</span>
              </div>
              {autoCloseEnabled && (
                <div className="stepper">
                  <button
                    className="stepper__btn"
                    onClick={() => setAutoCloseSec(v => clampSec(v - 1))}
                    disabled={autoCloseSec <= 1}
                  >
                    −
                  </button>
                  <span className="stepper__val">{autoCloseSec}s</span>
                  <button
                    className="stepper__btn"
                    onClick={() => setAutoCloseSec(v => clampSec(v + 1))}
                    disabled={autoCloseSec >= 60}
                  >
                    +
                  </button>
                </div>
              )}
            </section>
          </div>

          <aside className="modal__aside">
            <div className="modal__hint-head">Find these later</div>
            <div className="modal__hint-body">
              Use the <strong>≡</strong> menu in the top bar to access these settings at any time.
            </div>
          </aside>
        </div>

        {saved ? (
          <div className="saved">✓ Settings saved</div>
        ) : (
          <div className="modal__foot">
            <div className="modal__foot-meta">You can change these anytime via the ≡ menu.</div>
            <button className="btn btn--ghost" onClick={handleSkip}>Skip</button>
            <button className="btn btn--cta" onClick={handleSave} disabled={saving}>
              Save &amp; continue
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

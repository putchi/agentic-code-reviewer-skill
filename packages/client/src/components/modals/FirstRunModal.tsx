import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { Settings } from '../../lib/api';
import { ToggleSwitch } from '../atoms';

interface Props {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => Promise<Settings> | Settings | void;
  onReset: () => Promise<Settings> | Settings | void;
}

type StopHookMode = Settings['stopHookMode'];

const STOP_HOOK_MODES: Array<{ id: StopHookMode; title: string; sub: string; tag?: string }> = [
  {
    id: 'prompt',
    title: 'Ask before review',
    sub: 'Stop and wait for your yes/no/skip reply before review.',
    tag: 'default',
  },
  {
    id: 'auto',
    title: 'Run automatically',
    sub: 'Run a fast review on exit with a 3 minute budget.',
  },
  {
    id: 'disabled',
    title: 'Disabled',
    sub: 'Never start review from the Stop hook. Manual reviews still work.',
  },
];

export default function FirstRunModal({ settings, onSave, onReset }: Props) {
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(settings.autoCloseMs > 0);
  const [autoCloseSec, setAutoCloseSec] = useState(
    Math.max(Math.round(settings.autoCloseMs / 1000) || 3, 1)
  );
  const [stopHookMode, setStopHookMode] = useState<StopHookMode>(settings.stopHookMode || 'prompt');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);

  async function persist(patch: Partial<Settings>) {
    if (saving || saved) return;
    setSaving(true);
    try {
      await onSave(patch);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    void persist({
      autoCloseMs: autoCloseEnabled ? autoCloseSec * 1000 : 0,
      stopHookMode,
      firstRunDone: true,
    });
  }

  function handleSkip() {
    void persist({ firstRunDone: true });
  }

  async function handleReset() {
    if (resetting || saving) return;
    setAutoCloseEnabled(false);
    setAutoCloseSec(3);
    setStopHookMode('prompt');
    setResetting(true);
    try {
      await onReset();
    } catch {
      // The user can still save the visible defaults if the reset request fails.
    } finally {
      setResetting(false);
    }
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
              <div className="modal__section-label">AI runtime</div>
              <div className="modal__radiogroup">
                <div className="radiocard radiocard--readonly" data-checked aria-disabled="true">
                  <div className="radiocard__radio" />
                  <div className="radiocard__content">
                    <div className="radiocard__title">{settings.providerLabel}</div>
                    <div className="radiocard__sub">{settings.chatModelLabel} · {settings.modelRole}</div>
                  </div>
                  <div className="radiocard__tag">active</div>
                </div>
              </div>
              <div className="modal__hint">
                Detected from the launching host. To change models, set{' '}
                <code>models</code> in your repo&apos;s <code>.acr.json</code> (run <code>/acr-config</code>) or export{' '}
                <code>ACR_MODEL_BALANCED</code>/<code>ACR_MODEL_FAST</code>/<code>ACR_MODEL_JUDGE</code>.
              </div>
            </section>

            <section>
              <div className="modal__section-label">Session-exit hook</div>
              <div className="modal__radiogroup">
                {STOP_HOOK_MODES.map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    className="radiocard"
                    data-checked={stopHookMode === mode.id ? true : undefined}
                    onClick={() => setStopHookMode(mode.id)}
                  >
                    <div className="radiocard__radio" />
                    <div className="radiocard__content">
                      <div className="radiocard__title">{mode.title}</div>
                      <div className="radiocard__sub">{mode.sub}</div>
                    </div>
                    {mode.tag && <div className="radiocard__tag radiocard__tag--reco">{mode.tag}</div>}
                  </button>
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
            <div className="modal__aside-title">Find these later</div>
            <div className="modal__aside-text">
              Use the <strong>≡</strong> menu in the top bar to access these settings at any time.
            </div>
          </aside>
        </div>

        {saved ? (
          <div className="saved">✓ Settings saved</div>
        ) : (
          <div className="modal__foot">
            <div className="modal__foot-meta">You can change these anytime via the ≡ menu.</div>
            <button className="btn btn--ghost" onClick={handleSkip} disabled={saving}>Skip</button>
            <button className="btn btn--ghost" onClick={() => void handleReset()} disabled={saving || resetting}>
              Reset to defaults
            </button>
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

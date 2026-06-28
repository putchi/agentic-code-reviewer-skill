import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Settings } from '../../lib/api';
import { ToggleSwitch } from '../atoms';

interface Props {
  open: boolean;
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => Promise<Settings> | Settings | void;
  onClose: () => void;
  onHelp: () => void;
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

export default function SettingsPane({ open, settings, onUpdate, onReset, onClose, onHelp }: Props) {
  const [version, setVersion] = useState('');
  const [resetting, setResetting] = useState(false);
  const autoCloseSec = settings.autoCloseMs > 0 ? Math.round(settings.autoCloseMs / 1000) : 3;

  useEffect(() => {
    if (open && !version) {
      fetch('/api/version')
        .then(r => r.json())
        .then((d: { version: string }) => setVersion(d.version))
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      await onReset();
    } catch {
      // Keep the drawer usable if the local server rejects the reset.
    } finally {
      setResetting(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="modal__scrim" onClick={onClose}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-drawer__head">
          <span className="settings-drawer__title">Settings</span>
          {version && <span className="settings-drawer__version">v{version}</span>}
          <button className="btn btn--sm btn--icon btn--ghost" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12"/>
            </svg>
          </button>
        </div>

        <div className="settings-drawer__body">
          <section className="settings-drawer__section">
            <div className="modal__section-label">AI runtime</div>
            <div className="settings-drawer__radiogroup">
              <div className="radiocard radiocard--readonly" data-checked aria-disabled="true">
                <div className="radiocard__radio" />
                <div className="radiocard__content">
                  <div className="radiocard__title">{settings.providerLabel}</div>
                  <div className="radiocard__sub">{settings.chatModelLabel} · {settings.modelRole}</div>
                </div>
                <div className="radiocard__tag">active</div>
              </div>
            </div>
          </section>

          <div className="settings-drawer__divider" />

          <section className="settings-drawer__section">
            <div className="modal__section-label">Session-exit hook</div>
            <div className="settings-drawer__radiogroup">
              {STOP_HOOK_MODES.map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  className="radiocard"
                  data-checked={settings.stopHookMode === mode.id ? true : undefined}
                  onClick={() => onUpdate({ stopHookMode: mode.id })}
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

          <div className="settings-drawer__divider" />

          <section className="settings-drawer__section">
            <div className="modal__section-label">Auto-close</div>
            <div className="toggle-row">
              <ToggleSwitch
                on={settings.autoCloseMs > 0}
                onChange={v => onUpdate({ autoCloseMs: v ? autoCloseSec * 1000 : 0 })}
                ariaLabel="Enable auto-close"
              />
              <div className="toggle-row__main">
                <div className="toggle-row__title">Auto-close tab</div>
                <div className="toggle-row__sub">Close browser tab automatically after action completes</div>
              </div>
            </div>
            {settings.autoCloseMs > 0 && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Delay</span>
                <div className="stepper">
                  <button
                    className="stepper__btn"
                    onClick={() => onUpdate({ autoCloseMs: Math.max(1, autoCloseSec - 1) * 1000 })}
                    disabled={autoCloseSec <= 1}
                  >−</button>
                  <span className="stepper__val">{autoCloseSec}s</span>
                  <button
                    className="stepper__btn"
                    onClick={() => onUpdate({ autoCloseMs: Math.min(60, autoCloseSec + 1) * 1000 })}
                    disabled={autoCloseSec >= 60}
                  >+</button>
                </div>
              </div>
            )}
          </section>

          <div className="settings-drawer__divider" />

          <section className="settings-drawer__section">
            <button
              className="btn btn--ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={handleReset}
              disabled={resetting}
            >
              Reset to default settings
            </button>
          </section>

          <div className="settings-drawer__divider" />

          <section className="settings-drawer__section">
            <button
              className="btn btn--ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => { onClose(); onHelp(); }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="7"/>
                <path d="M6 6c0-1.1.9-2 2-2s2 .9 2 2c0 1-.7 1.5-1.5 2S8 9.5 8 10.5"/>
                <circle cx="8" cy="13" r=".6" fill="currentColor"/>
              </svg>
              Help &amp; keyboard shortcuts
            </button>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

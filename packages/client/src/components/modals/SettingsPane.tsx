import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Settings } from '../../lib/api';
import { ToggleSwitch } from '../atoms';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', sub: 'Balanced — fast and capable', tag: 'default' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', sub: 'Most capable, slower', tag: null },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', sub: 'Fastest, lightest', tag: null },
];

interface Props {
  open: boolean;
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onHelp: () => void;
}

export default function SettingsPane({ open, settings, onUpdate, onClose, onHelp }: Props) {
  const [version, setVersion] = useState('');
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
            <div className="modal__section-label">Chat model</div>
            <div className="settings-drawer__radiogroup">
              {MODELS.map(m => (
                <div
                  key={m.id}
                  className="radiocard"
                  data-checked={settings.chatModel === m.id ? '' : undefined}
                  onClick={() => onUpdate({ chatModel: m.id })}
                  role="radio"
                  aria-checked={settings.chatModel === m.id}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') onUpdate({ chatModel: m.id }); }}
                >
                  <div className="radiocard__radio" />
                  <div>
                    <div className="radiocard__title">{m.label}</div>
                    <div className="radiocard__sub">{m.sub}</div>
                  </div>
                  {m.tag && <div className="radiocard__tag">{m.tag}</div>}
                </div>
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

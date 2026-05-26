import { useEffect, useState } from 'react';
import type { Settings } from '../../lib/api';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (default)' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
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

  useEffect(() => {
    if (open && !version) {
      fetch('/api/version').then(r => r.json()).then((d: { version: string }) => setVersion(d.version)).catch(() => {});
    }
  }, [open]);

  const autoCloseSec = settings.autoCloseMs > 0 ? settings.autoCloseMs / 1000 : 3;

  return (
    <>
      {open && <div className="settings-pane-backdrop" onClick={onClose} />}
      <div className={`settings-pane${open ? ' open' : ''}`}>
        <div className="settings-pane-header">
          <span className="settings-pane-title">Settings</span>
          <button className="settings-pane-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-pane-body">
          <div className="settings-pane-row">
            <div className="settings-pane-label">Chat model</div>
            <div className="settings-pane-desc">AI model used in the Ask AI chat panel</div>
            <select className="settings-select" value={settings.chatModel}
              onChange={e => onUpdate({ chatModel: e.target.value })}>
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="settings-pane-divider" />
          <div className="settings-pane-row">
            <div className="settings-pane-label">Auto-close tab</div>
            <div className="settings-pane-desc">Close browser tab automatically after action completes</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
              <input type="checkbox" checked={settings.autoCloseMs > 0}
                onChange={e => onUpdate({ autoCloseMs: e.target.checked ? autoCloseSec * 1000 : 0 })}
                style={{ accentColor: 'var(--accent)' }} />
              Enable
            </label>
            {settings.autoCloseMs > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
                Delay (s):
                <input type="number" min={1} max={60} value={autoCloseSec}
                  onChange={e => onUpdate({ autoCloseMs: Number(e.target.value) * 1000 })}
                  style={{ width: 60, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '3px 6px', fontSize: 12 }} />
              </label>
            )}
          </div>
          <div className="settings-pane-divider" />
          <div className="settings-pane-row">
            <button className="settings-btn" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => { onClose(); onHelp(); }}>
              ? Help
            </button>
          </div>
          {version && <div className="settings-pane-version">v{version}</div>}
        </div>
      </div>
    </>
  );
}

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (default)' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

interface Props {
  model: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onModel: (m: string) => void;
  onClose: () => void;
}

export default function SettingsPopover({ model, anchorRef, onModel, onClose }: Props) {
  const rect = anchorRef.current?.getBoundingClientRect();
  const top = rect ? rect.bottom + 6 : 50;
  const right = rect ? window.innerWidth - rect.right : 16;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={onClose} />
      <div className="settings-popover" style={{ top, right }}>
        <div className="settings-row">
          <span className="settings-label">Chat model</span>
          <select className="settings-select" value={model} onChange={e => onModel(e.target.value)}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}

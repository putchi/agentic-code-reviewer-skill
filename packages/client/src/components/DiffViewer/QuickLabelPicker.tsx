import type { Selection } from '../../hooks/useAnnotations';

const LABELS = ['✅ Good', '⚠️ Review', '🔴 Fix required', '💡 Suggestion', '❓ Question', '🚀 Nice to have'];

interface Props {
  selection: Selection | null;
  anchorRect: DOMRect | null;
  onPick: (label: string) => void;
  onClose: () => void;
}

export default function QuickLabelPicker({ selection, anchorRect, onPick, onClose }: Props) {
  if (!selection || !anchorRect) return null;
  const top = anchorRect.bottom + 8;
  const left = Math.min(anchorRect.left, window.innerWidth - 200);
  return (
    <div id="label-picker" style={{ top, left }}>
      {LABELS.map(l => (
        <button key={l} className="label-opt" onClick={() => { onPick(l); onClose(); }}>{l}</button>
      ))}
      <button className="label-opt" style={{ color: 'var(--text-dim)' }} onClick={onClose}>Cancel</button>
    </div>
  );
}

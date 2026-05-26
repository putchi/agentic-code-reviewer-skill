import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComment, faWandMagicSparkles, faCopy, faBan, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { Selection } from '../../hooks/useAnnotations';

interface Props {
  selection: Selection | null;
  anchorRect: DOMRect | null;
  onComment: () => void;
  onAskAI: (prefill: string) => void;
  onRedline: () => void;
  onCancel: () => void;
}

export default function MiniToolbar({ selection, anchorRect, onComment, onAskAI, onRedline, onCancel }: Props) {
  if (!selection || !anchorRect) return null;
  const top = anchorRect.top - 44 + window.scrollY;
  const left = anchorRect.left + anchorRect.width / 2 - 120;
  return (
    <div id="mini-toolbar" style={{ top, left, position: 'fixed' }}>
      <button className="mini-btn" onClick={onComment}>
        <FontAwesomeIcon icon={faComment} className="ts-icon" /> Comment
      </button>
      <button className="mini-btn" onClick={() => onAskAI(selection.linesText)}>
        <FontAwesomeIcon icon={faWandMagicSparkles} className="ts-icon" /> Ask AI
      </button>
      <button className="mini-btn" onClick={() => { navigator.clipboard.writeText(selection.linesText).catch(() => {}); }}>
        <FontAwesomeIcon icon={faCopy} className="ts-icon" /> Copy
      </button>
      <button className="mini-btn" onClick={onRedline}>
        <FontAwesomeIcon icon={faBan} className="ts-icon" /> Redline
      </button>
      <button className="mini-btn" onClick={onCancel}>
        <FontAwesomeIcon icon={faXmark} className="ts-icon" />
      </button>
    </div>
  );
}

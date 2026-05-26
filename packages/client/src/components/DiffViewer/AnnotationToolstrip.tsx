import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMousePointer, faCrosshairs, faPen, faComment, faBan, faTag } from '@fortawesome/free-solid-svg-icons';
import type { AnnotMode } from '../../hooks/useAnnotations';

interface Props {
  mode: AnnotMode;
  pinpoint: boolean;
  onMode: (m: AnnotMode) => void;
  onPinpoint: (v: boolean) => void;
  onHelp: () => void;
}

export default function AnnotationToolstrip({ mode, pinpoint, onMode, onPinpoint, onHelp }: Props) {
  return (
    <div className="annotation-toolstrip">
      <div className="toolstrip-group">
        <button className={`toolstrip-btn${!pinpoint ? ' active' : ''}`} title="Drag to select text"
          onClick={() => onPinpoint(false)}>
          <FontAwesomeIcon icon={faMousePointer} className="ts-icon" />
          <span className="ts-label"> Select</span>
        </button>
        <button className={`toolstrip-btn${pinpoint ? ' active' : ''}`} title="Pinpoint: click to target a line"
          onClick={() => onPinpoint(true)}>
          <FontAwesomeIcon icon={faCrosshairs} className="ts-icon" />
          <span className="ts-label"> Pinpoint</span>
        </button>
      </div>
      <div className="toolstrip-group">
        <button className={`toolstrip-btn${mode === 'markup' ? ' active' : ''}`} title="Markup: select then choose action"
          onClick={() => onMode('markup')}>
          <FontAwesomeIcon icon={faPen} className="ts-icon" />
          <span className="ts-label"> Markup</span>
        </button>
        <button className={`toolstrip-btn${mode === 'comment' ? ' active' : ''}`} title="Select then comment immediately"
          onClick={() => onMode('comment')}>
          <FontAwesomeIcon icon={faComment} className="ts-icon" />
          <span className="ts-label"> Comment</span>
        </button>
        <button className={`toolstrip-btn${mode === 'redline' ? ' active' : ''}`} title="Redline: select to mark for deletion"
          onClick={() => onMode('redline')}>
          <FontAwesomeIcon icon={faBan} className="ts-icon" />
          <span className="ts-label"> Redline</span>
        </button>
        <button className={`toolstrip-btn${mode === 'quickLabel' ? ' active' : ''}`} title="Label: select then apply a quick label"
          onClick={() => onMode('quickLabel')}>
          <FontAwesomeIcon icon={faTag} className="ts-icon" />
          <span className="ts-label"> Label</span>
        </button>
      </div>
      <span className="toolstrip-help" onClick={onHelp}>how does this work?</span>
    </div>
  );
}

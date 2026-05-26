import type { ReviewData } from '@acr/shared';

interface Props {
  data: ReviewData | null;
  onMenu: () => void;
}

export default function Header({ data, onMenu }: Props) {
  return (
    <div className="header">
      <div>
        <div className="header-title">Agentic Code Review</div>
        <div className="header-meta">
          {data ? `${data.branch} · ${data.timestamp?.slice(0, 10)}` : 'Loading…'}
        </div>
      </div>
      <div className="verdict-block">
        <div className="verdict-label">Verdict</div>
        <div className="verdict-text">{data?.verdict || 'Loading…'}</div>
      </div>
      <button className="settings-btn" title="Menu" onClick={onMenu}>≡</button>
    </div>
  );
}

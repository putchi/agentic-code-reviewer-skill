import type { ReviewData } from '@acr/shared';

interface Props {
  data: ReviewData | null;
  onSettings: () => void;
  onHelp: () => void;
}

export default function Header({ data, onSettings, onHelp }: Props) {
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
      <button className="settings-btn" title="Help" onClick={onHelp}>?</button>
      <button className="settings-btn" title="Settings" onClick={onSettings}>⚙</button>
    </div>
  );
}

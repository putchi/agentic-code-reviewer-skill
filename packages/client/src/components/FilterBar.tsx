interface Props {
  activeFilter: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE';
  counts: { CRITICAL: number; HIGH: number; NOTE: number };
  onChange: (f: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE') => void;
}

export default function FilterBar({ activeFilter, counts, onChange }: Props) {
  return (
    <div className="filter-bar">
      <button className={`chip${activeFilter === 'ALL' ? ' active' : ''}`} onClick={() => onChange('ALL')}>All</button>
      <button className={`chip crit${activeFilter === 'CRITICAL' ? ' active' : ''}`} onClick={() => onChange('CRITICAL')}>
        CRITICAL: {counts.CRITICAL}
      </button>
      <button className={`chip high${activeFilter === 'HIGH' ? ' active' : ''}`} onClick={() => onChange('HIGH')}>
        HIGH: {counts.HIGH}
      </button>
      <button className={`chip note${activeFilter === 'NOTE' ? ' active' : ''}`} onClick={() => onChange('NOTE')}>
        NOTE: {counts.NOTE}
      </button>
    </div>
  );
}

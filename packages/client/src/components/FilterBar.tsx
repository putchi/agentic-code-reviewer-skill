interface Props {
  activeFilter: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE';
  counts: { CRITICAL: number; HIGH: number; NOTE: number };
  onChange: (f: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE') => void;
}

const CHIPS: Array<{ id: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE'; label: string; mod: string | null }> = [
  { id: 'ALL',      label: 'All',      mod: null },
  { id: 'CRITICAL', label: 'Critical', mod: 'critical' },
  { id: 'HIGH',     label: 'High',     mod: 'high' },
  { id: 'NOTE',     label: 'Note',     mod: 'note' },
];

export default function FilterBar({ activeFilter, counts, onChange }: Props) {
  const countFor = (id: 'ALL' | 'CRITICAL' | 'HIGH' | 'NOTE') => {
    if (id === 'ALL') return counts.CRITICAL + counts.HIGH + counts.NOTE;
    return counts[id];
  };

  return (
    <div className="fbar">
      <span className="fbar__label">Filter</span>
      {CHIPS.map(chip => (
        <button
          key={chip.id}
          className={`chip${chip.mod ? ` chip--sev-${chip.mod}` : ''}`}
          aria-pressed={activeFilter === chip.id}
          onClick={() => onChange(chip.id)}
        >
          {chip.mod ? <span className="chip__dot" /> : null}
          {chip.label}
          <span className="chip__count">{countFor(chip.id)}</span>
        </button>
      ))}
      <span className="fbar__spacer" />
      <span className="fbar__hint">
        <kbd>J</kbd>/<kbd>K</kbd> navigate &nbsp;
        <kbd>Space</kbd> select &nbsp;
        <kbd>Enter</kbd> open diff
      </span>
    </div>
  );
}

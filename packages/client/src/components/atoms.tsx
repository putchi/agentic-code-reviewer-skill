import React from 'react';

// SevBadge: replaces the old .badge.badge-CRITICAL/HIGH/NOTE pattern
export function SevBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={`sev sev--${s}`}>
      <span className="sev__dot" />
      {label}
    </span>
  );
}

// Checkbox: replaces native <input type="checkbox">
export function Checkbox({
  checked,
  onChange,
  ariaLabel = 'Toggle',
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="checkbox"
      data-checked={checked ? 'true' : undefined}
      aria-checked={checked}
      aria-label={ariaLabel}
      role="checkbox"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
    >
      {checked ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : null}
    </button>
  );
}

// ToggleSwitch
export function ToggleSwitch({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      data-on={on ? 'true' : undefined}
      onClick={() => onChange(!on)}
    />
  );
}

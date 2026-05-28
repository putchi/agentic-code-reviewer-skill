import React, { useState } from 'react';
import type { ReviewData, Finding, FindingAction, ReviewerResult } from '@acr/shared';
import { Checkbox, SevBadge } from '../atoms';
import { actionLabel, isImplementAction } from '../../lib/findingActions';

interface Props {
  data: ReviewData | null;
  selectedFindingId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelectFinding: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onAskAI: (prompt: string) => void;
}

const DIMENSIONS: Record<string, { id: string; name: string; desc: string; icon: string }> = {
  'semantic':     { id: 'semantic',      name: 'Semantic / Logic', desc: 'correctness & data flow',    icon: 'code' },
  'security':     { id: 'security',      name: 'Security',         desc: 'vulnerabilities & exposure', icon: 'shield' },
  'architecture': { id: 'architecture',  name: 'Architecture',     desc: 'module boundaries & design', icon: 'layers' },
  'tests':        { id: 'tests',         name: 'Test Coverage',    desc: 'coverage gaps & quality',    icon: 'flask' },
  'senior-dev':   { id: 'senior-dev',    name: 'Senior Dev',       desc: 'conventions & code quality', icon: 'graduation' },
};

const REVIEWERS: Record<string, { name: string; desc: string; icon: string }> = {
  'semantic-analyzer':      { name: 'Semantic Analyzer',      desc: 'correctness and data flow',       icon: 'code' },
  'security-scanner':       { name: 'Security Scanner',       desc: 'vulnerabilities and exposure',    icon: 'shield' },
  'architecture-reviewer':  { name: 'Architecture Reviewer',  desc: 'module boundaries and design',    icon: 'layers' },
  'test-coverage-analyzer': { name: 'Test Coverage Analyzer', desc: 'coverage gaps and quality',       icon: 'flask' },
  'senior-dev-reviewer':    { name: 'Senior Dev Reviewer',    desc: 'conventions and code quality',    icon: 'graduation' },
};

function DimIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'code':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'shield':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'layers':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
    case 'flask':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
        </svg>
      );
    case 'graduation':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
        </svg>
      );
    default:
      return null;
  }
}

function groupByDimension(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const dim = f.dimensions?.[0] ?? 'other';
    if (!groups.has(dim)) groups.set(dim, []);
    groups.get(dim)!.push(f);
  }
  return groups;
}

function getSevDot(severity: string) {
  const s = severity.toLowerCase();
  return <span key={s} className={`sev-dot sev-dot--${s}`} />;
}

function formatOptional(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 'Unknown';
  const text = String(value).trim();
  return text || 'Unknown';
}

function buildFindingAskPrompt(f: Finding) {
  const lines = [
    'Please explain this code review finding.',
    '',
    `Severity: ${f.severity}`,
    `Finding: ${formatOptional(f.finding)}`,
    `File: ${formatOptional(f.file)}`,
    `Location: ${formatOptional(f.location)}`,
    `Line: ${formatOptional(f.line)}`,
  ];

  if (f.reasoning?.trim()) {
    lines.push('', 'Reasoning:', f.reasoning.trim());
  }

  if (f.evidence?.trim()) {
    const evidence = f.evidence.trim();
    const fence = evidence.includes('```') ? '````' : '```';
    lines.push('', 'Evidence:', fence, evidence, fence);
  }

  lines.push(
    '',
    'Please explain why it matters, whether it is likely valid, and what fix approach I should use.'
  );

  return lines.join('\n');
}

interface FindingCardProps {
  f: Finding;
  selected: boolean;
  action: FindingAction | '';
  onSelect: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onAskAI: (prompt: string) => void;
}

function FindingCard({ f, selected, action, onSelect, onFindingAction, onAskAI }: FindingCardProps) {
  // Parse location into dir/filename + line
  const loc = f.location ?? '';
  const lineParts = loc.split(':');
  const filePart = lineParts[0] ?? '';
  const lineNum = lineParts[1] ? `· line ${lineParts[1]}` : '';
  const slashIdx = filePart.lastIndexOf('/');
  const dir = slashIdx >= 0 ? filePart.slice(0, slashIdx + 1) : '';
  const filename = slashIdx >= 0 ? filePart.slice(slashIdx + 1) : filePart;
  const markedForImplement = isImplementAction(action);

  return (
    <div className="card" data-selected={selected ? true : undefined}>
      <div className="card__check">
        <Checkbox
          checked={markedForImplement}
          ariaLabel={markedForImplement ? 'Deselect finding for implementation' : 'Select finding for implementation'}
          onChange={checked => onFindingAction(f.id, checked ? 'ask_claude_to_implement' : '')}
        />
      </div>
      <div className="card__main">
        <div className="card__row1">
          <SevBadge severity={f.severity} />
          {loc && (
            <span className="card__loc">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="card__loc-dir">{dir}</span>
              <span className="card__loc-file">{filename}</span>
              {lineNum && <span className="card__loc-line">{lineNum}</span>}
            </span>
          )}
        </div>
        <h3 className="card__title">{f.finding}</h3>
        <p className="card__reason">{f.reasoning ?? ''}</p>
      </div>
      <div className="card__actions">
        <span className={`finding__decision finding__decision--wide${markedForImplement ? ' finding__decision--implement' : action === 'ignore' ? ' finding__decision--dismiss' : ''}`}>
          {actionLabel(action)}
        </span>
        <button className="btn btn--sm" onClick={() => onSelect(f)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open diff
        </button>
        <button
          className="btn btn--sm btn--ghost"
          title="Ask AI about this finding"
          onClick={() => onAskAI(buildFindingAskPrompt(f))}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c-4.97 0-9 3.185-9 7.115 0 2.557 1.522 4.82 3.889 6.115L6 20l3.949-2.104A10.2 10.2 0 0 0 12 18.23c4.97 0 9-3.185 9-7.115S16.97 3 12 3z" />
          </svg>
          Ask AI
        </button>
      </div>
    </div>
  );
}

interface DimensionGroupProps {
  dim: string;
  items: Finding[];
  selectedFindingId: string | null;
  findingActions: Record<string, FindingAction | ''>;
  onSelectFinding: (finding: Finding) => void;
  onFindingAction: (id: string, action: FindingAction | '') => void;
  onAskAI: (prompt: string) => void;
}

function DimensionGroup({ dim, items, selectedFindingId, findingActions, onSelectFinding, onFindingAction, onAskAI }: DimensionGroupProps) {
  const hasCritical = items.some(i => i.severity === 'CRITICAL');
  const [open, setOpen] = useState(hasCritical);

  const dimInfo = DIMENSIONS[dim];
  const dimLabel = dimInfo?.name ?? dim;
  const dimDesc = dimInfo?.desc ?? '';
  const dimIcon = dimInfo?.icon ?? 'code';

  return (
    <div className={`dim${open ? ' dim--open' : ''}`} data-open={open ? 'true' : undefined}>
      <button
        className="dim__head"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="dim__chev" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span className="dim__title">
          <span style={{ color: 'var(--fg-faint)' }}><DimIcon icon={dimIcon} /></span>
          <span className="dim__name">{dimLabel}</span>
          <span className="dim__desc">{dimDesc}</span>
        </span>
        <span className="dim__meta">
          <span className="dim__sev-dots">
            {items.map((item, i) => (
              <span key={i} className={`sev-dot sev-dot--${item.severity.toLowerCase()}`} />
            ))}
          </span>
          <span className="dim__count">{items.length} finding{items.length !== 1 ? 's' : ''}</span>
        </span>
      </button>
      {open && (
        <div className="dim__body">
          {items.map(f => (
            <FindingCard
              key={f.id}
              f={f}
              selected={selectedFindingId === f.id}
              action={findingActions[f.id] || ''}
              onSelect={onSelectFinding}
              onFindingAction={onFindingAction}
              onAskAI={onAskAI}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ReviewerGroupProps {
  result: ReviewerResult;
  onSelectFinding: (finding: Finding) => void;
}

function ReviewerFindingCard({ f, onSelect }: { f: Finding; onSelect: (finding: Finding) => void }) {
  const loc = f.location || `${f.file}:${f.line || ''}`;
  return (
    <div className="card card--reviewer">
      <div className="card__main">
        <div className="card__row1">
          <SevBadge severity={f.severity} />
          <span className="card__loc" title={loc}>{loc}</span>
        </div>
        <h3 className="card__title">{f.finding}</h3>
        {f.reasoning && <p className="card__reason">{f.reasoning}</p>}
        {f.evidence && <p className="card__evidence mono">{f.evidence}</p>}
      </div>
      <div className="card__actions">
        <button className="btn btn--sm" onClick={() => onSelect(f)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open diff
        </button>
      </div>
    </div>
  );
}

function ReviewerGroup({ result, onSelectFinding }: ReviewerGroupProps) {
  const hasFindings = result.findings.length > 0;
  const failed = result.status === 'failed';
  const [open, setOpen] = useState(hasFindings || failed);
  const meta = REVIEWERS[result.agent] ?? { name: result.agent, desc: '', icon: 'code' };

  return (
    <div className={`dim${open ? ' dim--open' : ''}`} data-open={open ? 'true' : undefined}>
      <button className="dim__head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="dim__chev" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span className="dim__title">
          <span style={{ color: 'var(--fg-faint)' }}><DimIcon icon={meta.icon} /></span>
          <span className="dim__name">{meta.name}</span>
          <span className="dim__desc">{meta.desc}</span>
        </span>
        <span className="dim__meta">
          <span className={`reviewer-status reviewer-status--${result.status}`}>{result.status}</span>
          <span className="dim__count">{result.findings.length} finding{result.findings.length !== 1 ? 's' : ''}</span>
        </span>
      </button>
      {open && (
        <div className="dim__body">
          {failed && (
            <div className="reviewer-empty reviewer-empty--error">
              {result.error || 'Reviewer failed without an error message.'}
            </div>
          )}
          {!failed && !hasFindings && (
            <div className="reviewer-empty">No findings from this reviewer.</div>
          )}
          {result.findings.map(f => (
            <ReviewerFindingCard key={`${result.agent}:${f.id}`} f={f} onSelect={onSelectFinding} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResultsView({ data, selectedFindingId, findingActions, onSelectFinding, onFindingAction, onAskAI }: Props) {
  if (!data) {
    return (
      <div style={{ padding: '24px', color: 'var(--fg-faint)', fontSize: 13 }}>
        Loading review results…
      </div>
    );
  }

  const critCount = data.findings.filter(f => f.severity === 'CRITICAL').length;
  const highCount = data.findings.filter(f => f.severity === 'HIGH').length;
  const noteCount = data.findings.filter(f => f.severity === 'NOTE').length;

  const v = (data.verdict ?? '').toLowerCase();
  const verdictLabel = data.synthesisStatus === 'synthesis_failed'
    ? 'Synthesis Failed'
    : v.includes('critical')
    ? 'Critical Issues'
    : v.includes('high')
    ? 'Needs Attention'
    : 'Review Complete';

  const addCount = (data.files ?? []).reduce((s, f) => s + (f.add ?? 0), 0);
  const delCount = (data.files ?? []).reduce((s, f) => s + (f.del ?? 0), 0);

  const groups = groupByDimension(data.findings);

  return (
    <div className="results">
      <div className="verdict">
        <div className="verdict__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="verdict__body">
          <div className="verdict__label">Verdict — {verdictLabel}</div>
          <p className="verdict__text">{data.verdict}</p>
          <div className="verdict__meta">
            {critCount > 0 && (
              <span className="sev sev--critical" style={{ padding: '1px 6px', fontSize: 10 }}>
                <span className="sev__dot" />{critCount} critical
              </span>
            )}
            {highCount > 0 && (
              <span className="sev sev--high" style={{ padding: '1px 6px', fontSize: 10 }}>
                <span className="sev__dot" />{highCount} high
              </span>
            )}
            {noteCount > 0 && (
              <span className="sev sev--note" style={{ padding: '1px 6px', fontSize: 10 }}>
                <span className="sev__dot" />{noteCount} note
              </span>
            )}
            <span className="mono">{(data.files ?? []).length} files · +{addCount} −{delCount}</span>
          </div>
        </div>
      </div>

      {(data.reviewerResults?.length ?? 0) > 0 && (
        <>
          <div className="results__section-head">
            <span>Reviewer agents</span>
            <span className="line" />
          </div>
          {data.reviewerResults!.map(result => (
            <ReviewerGroup
              key={result.agent}
              result={result}
              onSelectFinding={onSelectFinding}
            />
          ))}
        </>
      )}

      {groups.size > 0 && (
        <>
          <div className="results__section-head">
            <span>Findings by dimension</span>
            <span className="line" />
          </div>
          {Array.from(groups.entries()).map(([dim, items]) => (
            <DimensionGroup
              key={dim}
              dim={dim}
              items={items}
              selectedFindingId={selectedFindingId}
              findingActions={findingActions}
              onSelectFinding={onSelectFinding}
              onFindingAction={onFindingAction}
              onAskAI={onAskAI}
            />
          ))}
        </>
      )}

      {groups.size === 0 && (
        <div style={{ color: 'var(--fg-faint)', fontSize: 13, padding: '16px 0' }}>No findings.</div>
      )}
    </div>
  );
}

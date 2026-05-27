import type { ReviewData, Finding } from '@acr/shared';

interface Props {
  data: ReviewData | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  semantic: 'Semantic / Logic',
  security: 'Security',
  architecture: 'Architecture',
  tests: 'Test Coverage',
  'senior-dev': 'Senior Dev',
};

function groupByDimension(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const dim = f.dimensions?.[0] ?? 'other';
    if (!groups.has(dim)) groups.set(dim, []);
    groups.get(dim)!.push(f);
  }
  return groups;
}

export default function ResultsView({ data }: Props) {
  if (!data) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-dim)', fontSize: '13px' }}>
        Loading review results…
      </div>
    );
  }

  const groups = groupByDimension(data.findings);

  return (
    <div className="results-view" style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
      {data.verdict && (
        <div className="results-verdict" style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-2)', borderRadius: '6px', fontSize: '13px', lineHeight: 1.5 }}>
          <strong>Verdict</strong>
          <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{data.verdict}</p>
        </div>
      )}
      {data.summary && (
        <div style={{ marginBottom: '16px', fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {data.summary}
        </div>
      )}
      {groups.size === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>No findings.</div>
      )}
      {Array.from(groups.entries()).map(([dim, findings]) => (
        <details key={dim} style={{ marginBottom: '8px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: '6px 4px', userSelect: 'none' }}>
            {DIMENSION_LABELS[dim] ?? dim} ({findings.length})
          </summary>
          <div style={{ paddingLeft: '12px', marginTop: '6px' }}>
            {findings.map(f => (
              <div key={f.id} className={`result-finding result-finding-${f.severity.toLowerCase()}`}
                style={{ marginBottom: '8px', padding: '8px', background: 'var(--bg-2)', borderRadius: '4px', fontSize: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span className={`badge badge-${f.severity}`}>{f.severity}</span>
                  <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{f.location}</span>
                </div>
                <div style={{ lineHeight: 1.4 }}>{f.finding}</div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

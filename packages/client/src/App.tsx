import { useState } from 'react';
import type { Finding } from '@acr/shared';
import { useReviewData } from './hooks/useReviewData';
import { useLocalStorage } from './hooks/useLocalStorage';

export default function App() {
  const { data, isLoading, error } = useReviewData();
  const [activeFilter, setActiveFilter] = useState<'ALL'|'CRITICAL'|'HIGH'|'NOTE'>('ALL');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useLocalStorage('acr-right-panel', true);
  const [splitView, setSplitView] = useLocalStorage('acr-split-view', false);

  if (isLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-dim)' }}>
      Loading review data…
    </div>
  );
  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--red)' }}>
      Error: {error}
    </div>
  );

  const counts = { CRITICAL: 0, HIGH: 0, NOTE: 0 };
  for (const f of data?.findings ?? []) {
    if (f.severity in counts) counts[f.severity as keyof typeof counts]++;
  }

  const filtered = (data?.findings ?? []).filter(
    f => activeFilter === 'ALL' || f.severity === activeFilter
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      {/* Header */}
      <div className="header-placeholder" style={{ padding:'8px 12px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px' }}>
        <span style={{ fontWeight:600, fontSize:'14px' }}>Agentic Code Review</span>
        {data && <span style={{ color:'var(--text-muted)', fontSize:'12px' }}>{data.branch} · {data.timestamp?.slice(0,10)}</span>}
        {data?.verdict && <span style={{ marginLeft:'auto', color:'var(--text)', fontSize:'12px' }}>{data.verdict}</span>}
      </div>

      {/* Filter bar */}
      <div style={{ padding:'6px 12px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', gap:'8px' }}>
        {(['ALL','CRITICAL','HIGH','NOTE'] as const).map(f => (
          <button key={f} onClick={() => setActiveFilter(f)}
            style={{ padding:'3px 10px', borderRadius:'var(--radius)', border:'1px solid var(--border)',
              background: activeFilter === f ? 'var(--surface2)' : 'var(--surface)',
              color: f === 'CRITICAL' ? 'var(--critical)' : f === 'HIGH' ? 'var(--high)' : f === 'NOTE' ? 'var(--note)' : 'var(--text)',
              cursor:'pointer', fontSize:'12px' }}>
            {f === 'ALL' ? 'All' : `${f}: ${counts[f as keyof typeof counts]}`}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Left panel */}
        <div style={{ width:'280px', flexShrink:0, background:'var(--bg2)', borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:'12px', color:'var(--text-muted)' }}>
            {filtered.length} finding{filtered.length !== 1 ? 's' : ''}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'4px' }}>
            {filtered.map(f => (
              <div key={f.id} onClick={() => { setSelectedFinding(f); setSelectedFile(f.file); }}
                style={{ padding:'8px', marginBottom:'2px', borderRadius:'var(--radius)', cursor:'pointer',
                  background: selectedFinding?.id === f.id ? 'var(--surface2)' : 'transparent',
                  borderLeft:`3px solid ${f.severity==='CRITICAL' ? 'var(--critical)' : f.severity==='HIGH' ? 'var(--high)' : 'var(--note)'}` }}>
                <div style={{ fontSize:'11px', color: f.severity==='CRITICAL' ? 'var(--critical)' : f.severity==='HIGH' ? 'var(--high)' : 'var(--note)', marginBottom:'2px' }}>
                  [{f.severity}]
                </div>
                <div style={{ fontSize:'12px', color:'var(--text)' }}>{f.finding}</div>
                <div style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'2px' }}>{f.location}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Center panel */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--bg)' }}>
          <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ color:'var(--text-muted)', fontSize:'12px' }}>
              {selectedFile ?? 'No file selected'}
            </span>
            <button onClick={() => setRightPanelOpen(!rightPanelOpen)}
              style={{ marginLeft:'auto', padding:'3px 8px', borderRadius:'var(--radius)', border:'1px solid var(--border)',
                background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:'12px' }}>
              {rightPanelOpen ? '▶ Hide panel' : '◀ Show panel'}
            </button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'12px', fontFamily:'monospace', fontSize:'12px' }}>
            {selectedFile
              ? <pre style={{ color:'var(--text)' }}>{data?.files.find(f => f.path === selectedFile)?.diff ?? '(no diff)'}</pre>
              : <div style={{ color:'var(--text-dim)', padding:'24px' }}>Select a finding or file to view diff</div>
            }
          </div>
        </div>

        {/* Right panel */}
        {rightPanelOpen && (
          <div style={{ width:'300px', flexShrink:0, background:'var(--bg2)', borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center' }}>
              <span style={{ fontSize:'13px', fontWeight:500 }}>Comments</span>
              <button onClick={() => setRightPanelOpen(false)}
                style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:'14px' }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'8px' }}>
              <div style={{ color:'var(--text-dim)', fontSize:'12px', padding:'8px' }}>
                No comments yet. Select findings and add notes.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div style={{ padding:'8px 12px', background:'var(--bg2)', borderTop:'1px solid var(--border)', display:'flex', gap:'8px', alignItems:'center' }}>
        <button style={{ padding:'6px 16px', borderRadius:'var(--radius)', border:'none',
          background:'var(--accent)', color:'var(--bg3)', cursor:'pointer', fontSize:'13px', fontWeight:500 }}>
          Implement
        </button>
        <button style={{ padding:'6px 16px', borderRadius:'var(--radius)', border:'1px solid var(--border)',
          background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:'13px' }}>
          Save
        </button>
        <button style={{ padding:'6px 16px', borderRadius:'var(--radius)', border:'1px solid var(--border)',
          background:'var(--surface)', color:'var(--text)', cursor:'pointer', fontSize:'13px' }}>
          Done
        </button>
      </div>
    </div>
  );
}

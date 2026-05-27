import type { FileEntry } from '@acr/shared';

interface Props {
  files: FileEntry[];
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export default function FilesList({ files, query, selectedPath, onSelect }: Props) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? files.filter(f => f.path.toLowerCase().includes(q))
    : files;

  if (!filtered.length) {
    return (
      <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 12 }}>
        No files match this filter.
      </div>
    );
  }

  // Group by first two path segments
  const groups = new Map<string, FileEntry[]>();
  for (const f of filtered) {
    const segs = f.path.split('/');
    const groupKey = segs.length >= 2 ? segs[0] + '/' + segs[1] : segs[0];
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(f);
  }

  return (
    <>
      {Array.from(groups.entries()).map(([group, groupFiles]) => (
        <div key={group} className="files__group">
          <div className="files__header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>{group}</span>
          </div>
          {groupFiles.map(f => {
            const selected = selectedPath === f.path;
            const name = f.path.split('/').slice(2).join('/');
            const hasSlash = name.includes('/');
            const dirPart = hasSlash ? name.replace(/\/[^/]+$/, '/') : '';
            const baseName = name.split('/').pop() ?? name;

            return (
              <div
                key={f.path}
                className="file"
                data-selected={selected ? true : undefined}
                onClick={() => onSelect(f.path)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
                </svg>
                <span className="file__name">
                  <span className="dim">{dirPart}</span>{baseName}
                </span>
                <span className="file__counts">
                  <span className="file__add">+{f.add}</span>
                  <span className="file__del">−{f.del}</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

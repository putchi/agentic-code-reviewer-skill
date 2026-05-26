import type { FileEntry, Finding } from '@acr/shared';

interface Props {
  files: FileEntry[];
  findings: Finding[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}

export default function FilesList({ files, findings, selectedFile, onSelect }: Props) {
  if (!files.length) {
    return <div className="empty-state">No files</div>;
  }
  return (
    <>
      {files.map(f => {
        const count = findings.filter(fi => fi.file === f.path).length;
        return (
          <div key={f.path} className={`file-item${selectedFile === f.path ? ' active' : ''}`}
            onClick={() => onSelect(f.path)}>
            <span className="file-name" title={f.path}>{f.path.split('/').pop()}</span>
            {count > 0 && <span className="file-count">{count}</span>}
          </div>
        );
      })}
    </>
  );
}

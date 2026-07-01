import { renameSync, writeFileSync } from 'node:fs';

// Write-to-tmp + rename, mirroring write_json/write_atomic in scripts/*.py,
// so readers (gate, resume) never observe a partially written JSON file.
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

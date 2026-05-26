export interface DiffRow {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  newLine?: number;
  oldLine?: number;
}
export function parseDiff(diffText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  if (!diffText) return rows;
  let newLine = 0, oldLine = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(raw);
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
      rows.push({ type: 'hunk', text: raw });
    } else if (raw.startsWith('+')) {
      rows.push({ type: 'add', text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      rows.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith('\\')) {
      // no-newline-at-eof marker — skip
    } else {
      rows.push({ type: 'ctx', text: raw.replace(/^ /, ''), newLine: newLine++, oldLine: oldLine++ });
    }
  }
  return rows;
}

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
  let inHunk = false;
  for (const raw of diffText.split('\n')) {
    if (!inHunk && (
      raw === '' ||
      raw.startsWith('diff --git ') ||
      raw.startsWith('index ') ||
      raw.startsWith('new file mode ') ||
      raw.startsWith('deleted file mode ') ||
      raw.startsWith('old mode ') ||
      raw.startsWith('new mode ') ||
      raw.startsWith('similarity index ') ||
      raw.startsWith('dissimilarity index ') ||
      raw.startsWith('rename from ') ||
      raw.startsWith('rename to ') ||
      raw.startsWith('copy from ') ||
      raw.startsWith('copy to ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ')
    )) {
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(raw);
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
      inHunk = true;
      rows.push({ type: 'hunk', text: raw });
    } else if (!inHunk) {
      continue;
    } else if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      continue;
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

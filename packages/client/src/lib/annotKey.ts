export function annotKey(file: string, lineStart: number, lineEnd: number, side: 'new'|'old') {
  return `${file}|${lineStart}|${lineEnd}|${side}`;
}

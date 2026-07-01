import type { ReviewData } from '@acr/shared';

export function buildChatSystemPrompt(reviewData: ReviewData, currentFile?: string): string {
  const lines: string[] = [];
  lines.push('You are a code review assistant. The user is reviewing a git diff and has questions.');
  lines.push('Answer concisely based on the diff and findings below.');
  lines.push('', '## Verdict', reviewData.verdict || '(no verdict)', '');
  lines.push('## Findings');
  for (const f of (reviewData.findings || []).slice(0, 10)) {
    lines.push(`[${f.severity || 'NOTE'}] ${f.file || ''}:${f.line || ''} — ${f.finding || ''}`);
  }
  if (currentFile) lines.push('', '## Current File', currentFile);
  lines.push('', '## Full Diff', '```diff');
  const parts: string[] = [];
  for (const f of (reviewData.files || [])) if (f.diff) parts.push(`--- ${f.path}\n${f.diff}`);
  let fullDiff = parts.join('\n\n');
  const truncated = fullDiff.length > 40000;
  if (truncated) fullDiff = fullDiff.slice(0, 40000) + '\n...[diff truncated at 40KB — later files are not visible to you]';
  lines.push(fullDiff, '```');
  if (truncated) {
    lines.push('', 'Note: the diff above was truncated at 40KB. If asked about code you cannot see, say so rather than guessing.');
  }
  return lines.join('\n');
}

import type { ReviewData } from '@acr/shared';

export function buildChatSystemPrompt(reviewData: ReviewData, currentFile?: string): string {
  const lines: string[] = [];
  lines.push('You are a code review assistant. The user is reviewing a git diff and has questions.');
  lines.push('Answer concisely based on the diff and findings below.');
  const pr = reviewData.pr;
  if (pr && (pr.number || pr.url)) {
    lines.push('', '## Pull Request');
    lines.push(`This review is of PR #${pr.number ?? '?'}${pr.title ? ` — ${pr.title}` : ''} (${pr.url || 'no url'}), merging ${pr.headRefName || '?'} into ${pr.baseRefName || '?'}.`);
    lines.push('The local working tree may NOT match the PR head — do not trust local file reads for changed files.');
    if (pr.headRefName) {
      lines.push(`To read a full file at the PR head, run \`git fetch origin ${pr.headRefName}\` then \`git show FETCH_HEAD:<path>\`${pr.number ? `, or \`gh pr view ${pr.number}\` / \`gh pr diff ${pr.number}\` for metadata` : ''}. Otherwise answer from the embedded diff below.`);
    }
  }
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

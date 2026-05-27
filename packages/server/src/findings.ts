import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEW_AGENTS } from '@acr/shared';
import type { DecisionsFile, FileEntry, LineAnnotation, RawReviewerResult, ReviewData, ReviewerResult, RunContext, SynthesisResult } from '@acr/shared';
import { findingsFile, runDir, saveDir, sessionId } from './config';

function parseJsonFile<T>(file: string | null): T | null {
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; }
  catch { return null; }
}

export function splitUnifiedDiff(diffText: string): FileEntry[] {
  if (!diffText.trim()) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ') && current.length) {
      chunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join('\n'));

  return chunks
    .map(chunk => {
      const header = chunk.split('\n')[0] || '';
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);
      if (!match) return null;
      const path = match[2];
      let add = 0, del = 0;
      for (const line of chunk.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) add++;
        if (line.startsWith('-')) del++;
      }
      return { path, diff: chunk, add, del };
    })
    .filter((f): f is FileEntry => !!f);
}

function readRunFiles(contextPath: string | null, diffPath: string | null): FileEntry[] {
  const context = parseJsonFile<RunContext>(contextPath);
  if (Array.isArray(context?.files) && context.files.length) return context.files;
  if (diffPath && existsSync(diffPath)) return splitUnifiedDiff(readFileSync(diffPath, 'utf8'));
  return [];
}

function readRunStatus(runPath: string | null): string | undefined {
  const run = parseJsonFile<{ status?: string }>(runPath);
  return run?.status;
}

function normalizeReviewerResult(raw: RawReviewerResult): ReviewerResult {
  return {
    agent: raw.agent,
    status: raw.status,
    error: raw.error,
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    findings: (raw.findings || []).map((f, index) => ({
      id: f.id || `${raw.agent}-${index + 1}`,
      severity: f.severity || 'HIGH',
      file: f.file || '',
      line: Number(f.line || 0),
      location: f.location || `${f.file || ''}:${f.line || 0}`,
      finding: f.finding || '',
      reasoning: f.reasoning,
      evidence: f.evidence,
      source_agents: [raw.agent],
    })),
  };
}

function readReviewerResults(dir: string): ReviewerResult[] {
  const agentDir = join(dir, 'agents');
  const anyAgentFile = REVIEW_AGENTS.some(agent => existsSync(join(agentDir, `${agent}.json`)));
  if (!anyAgentFile) return [];

  return REVIEW_AGENTS.map(agent => {
    const result = parseJsonFile<RawReviewerResult>(join(agentDir, `${agent}.json`));
    if (!result) {
      return {
        agent,
        status: 'failed',
        error: 'Reviewer result file was not written.',
        findings: [],
      };
    }
    return normalizeReviewerResult(result);
  });
}

export function readReviewFromRunDir(dir: string): ReviewData | null {
  const synthesisPath = join(dir, 'synthesis.json');
  const contextPath = join(dir, 'context.json');
  const diffPath = join(dir, 'diff.txt');
  const runPath = join(dir, 'run.json');
  const synthesis = parseJsonFile<SynthesisResult>(synthesisPath);
  if (!synthesis) return null;
  const context = parseJsonFile<RunContext>(contextPath);
  return {
    verdict: synthesis.two_sentence_verdict || '',
    findings: (synthesis.deduped_findings || []).map((f, index) => ({
      id: f.id || `f${index + 1}`,
      severity: f.severity || 'NOTE',
      file: f.file || '',
      line: Number(f.line || 0),
      location: f.location || `${f.file || ''}:${f.line || 0}`,
      finding: f.finding || '',
      reasoning: f.reasoning,
      evidence: f.evidence,
      dimensions: f.dimensions || f.source_agents,
      source_agents: f.source_agents || [],
    })),
    files: readRunFiles(contextPath, diffPath),
    reviewerResults: readReviewerResults(dir),
    summary: (synthesis.recommended_next_actions || []).join('\n'),
    timestamp: context?.timestamp || new Date().toISOString(),
    branch: context?.branch || '',
    sessionId,
    runId: synthesis.run_id,
    synthesisStatus: readRunStatus(runPath),
    resumeCommand: `/review-resume ${synthesis.run_id}`,
    recommendedNextActions: synthesis.recommended_next_actions || [],
  };
}

function readFromSynthesis(): ReviewData | null {
  if (!runDir) return null;
  return readReviewFromRunDir(runDir);
}

export function readFindings(): ReviewData {
  const runReview = readFromSynthesis();
  if (runReview) return runReview;
  try {
    const review = JSON.parse(readFileSync(findingsFile, 'utf8'));
    if (!Array.isArray(review.files)) review.files = [];
    return review;
  }
  catch {
    return { verdict: '', findings: [], files: [], summary: '',
             timestamp: new Date().toISOString(), branch: '', sessionId };
  }
}

function ensureDir(dir: string) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

export function saveMarkdown(
  data: ReviewData & { _decision?: any },
  lineAnnotations?: Record<string, LineAnnotation>
): string {
  ensureDir(saveDir);
  const date = new Date().toISOString().slice(0, 10);
  const branch = (data.branch || 'unknown').replace(/[^a-z0-9_-]/gi, '-');
  const filepath = join(saveDir, `${date}-${branch}.md`);

  const groups: Record<string, any[]> = { CRITICAL: [], HIGH: [], NOTE: [] };
  for (const f of data.findings || []) {
    const sev = (f.severity || 'NOTE').toUpperCase();
    (groups[sev] || groups.NOTE).push(f);
  }
  const decision = data._decision || {};
  const findingDecisions: DecisionsFile['findings'] = decision.findings || decision.findingDecisions || {};
  const selectedIds = new Set<string>(decision.selectedIds || Object.entries(findingDecisions)
    .filter(([, d]: any) => d.action === 'ask_claude_to_implement' || d.action === 'accept_fix')
    .map(([id]) => id));
  const dismissedIds = new Set<string>(decision.dismissedIds || Object.entries(findingDecisions)
    .filter(([, d]: any) => d.action === 'ignore')
    .map(([id]) => id));
  const dismissReasons: Record<string, string> = decision.dismissReasons || {};
  const comments: Record<string, string> = decision.comments || {};
  const globalComment: string = decision.globalComment || decision.global_comment || '';

  let md = `# Code Review — ${date} (branch: ${data.branch || 'unknown'})\n\n`;
  md += `**Verdict:** ${data.verdict || '_No verdict_'}\n\n`;
  if (globalComment) md += `> **Your notes:** ${globalComment}\n\n`;

  const dismissedFindings: any[] = [];
  for (const [sev, items] of Object.entries(groups)) {
    const active = items.filter((f: any) => !dismissedIds.has(f.id));
    const dismissed = items.filter((f: any) => dismissedIds.has(f.id));
    dismissedFindings.push(...dismissed);
    md += `## ${sev}\n\n`;
    if (!active.length) { md += '_None._\n\n'; continue; }
    for (const f of active) {
      const action = findingDecisions[f.id]?.action;
      const status = action ? action.replaceAll('_', ' ') : (selectedIds.has(f.id) ? 'selected for implementation' : 'not selected');
      md += `- **${f.location || f.file}** — ${f.finding}\n`;
      if (f.reasoning) md += `  - Reasoning: ${f.reasoning}\n`;
      if (f.evidence) md += `  - Evidence: \`${f.evidence}\`\n`;
      if (f.dimensions?.length) md += `  - Dimensions: ${f.dimensions.join(', ')}\n`;
      md += `  - Decision: ${status}\n`;
      const comment = comments[f.id] || findingDecisions[f.id]?.comment;
      if (comment) md += `  - Your comment: "${comment}"\n`;
      md += '\n';
    }
  }
  md += `## Summary\n\n${data.summary || ''}\n\n`;

  if (dismissedFindings.length) {
    md += `## Dismissed Findings\n\n`;
    for (const f of dismissedFindings) {
      md += `- **[${f.severity}]** **${f.location || f.file}** — ${f.finding}\n`;
      const reason = dismissReasons[f.id] || findingDecisions[f.id]?.comment;
      if (reason) md += `  - Reason: ${reason}\n`;
      md += '\n';
    }
  }

  const annots = lineAnnotations || {};
  const keys = Object.keys(annots);
  if (keys.length) {
    md += `## Line Annotations\n\n`;
    for (const k of keys) {
      const a = annots[k];
      md += `- **${a.file}** lines ${a.lineStart}–${a.lineEnd} (${a.side}): [${a.type}] ${a.text}\n`;
    }
    md += '\n';
  }
  md += `---\n_Generated by agentic-code-reviewer_\n`;
  writeFileSync(filepath, md, 'utf8');
  return filepath;
}

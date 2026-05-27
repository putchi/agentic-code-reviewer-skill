import type { Finding, FileEntry } from './findings';
import type { DecisionsFile, FindingAction, FindingDecision } from './decisions';

export const REVIEW_AGENTS = [
  'semantic-analyzer',
  'security-scanner',
  'architecture-reviewer',
  'test-coverage-analyzer',
  'senior-dev-reviewer',
] as const;

export type ReviewAgent = typeof REVIEW_AGENTS[number];
export type ReviewerStatus = 'complete' | 'failed';

export interface RawReviewerFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH';
  file: string;
  line: number;
  location: string;
  finding: string;
  reasoning: string;
  evidence: string;
  confidence: number;
}

export interface RawReviewerResult {
  run_id: string;
  agent: ReviewAgent;
  status: ReviewerStatus;
  started_at: string;
  completed_at: string;
  error: string | null;
  findings: RawReviewerFinding[];
}

export interface SynthesisFinding extends Finding {
  source_agents: string[];
}

export interface SynthesisResult {
  run_id: string;
  two_sentence_verdict: string;
  deduped_findings: SynthesisFinding[];
  dropped_findings_with_reason: unknown[];
  contradictions_resolved: unknown[];
  severity_rationale: Record<string, string>;
  recommended_next_actions: string[];
  source_agent_result_files: string[];
}

export interface RunContext {
  run_id: string;
  repo: string;
  branch?: string;
  timestamp: string;
  pr?: Record<string, unknown> | null;
  files?: FileEntry[];
}

export function isFindingAction(value: unknown): value is FindingAction {
  return typeof value === 'string' && [
    'accept_fix',
    'ignore',
    'create_follow_up_task',
    'ask_claude_to_explain',
    'ask_claude_to_implement',
  ].includes(value);
}

export function validateRawReviewerResult(value: unknown): value is RawReviewerResult {
  const v = value as RawReviewerResult;
  return !!v
    && typeof v.run_id === 'string'
    && REVIEW_AGENTS.includes(v.agent as ReviewAgent)
    && (v.status === 'complete' || v.status === 'failed')
    && typeof v.started_at === 'string'
    && typeof v.completed_at === 'string'
    && (v.error === null || typeof v.error === 'string')
    && Array.isArray(v.findings);
}

export function validateSynthesisResult(value: unknown): value is SynthesisResult {
  const v = value as SynthesisResult;
  return !!v
    && typeof v.run_id === 'string'
    && typeof v.two_sentence_verdict === 'string'
    && Array.isArray(v.deduped_findings)
    && Array.isArray(v.dropped_findings_with_reason)
    && Array.isArray(v.contradictions_resolved)
    && typeof v.severity_rationale === 'object'
    && v.severity_rationale !== null
    && Array.isArray(v.recommended_next_actions)
    && Array.isArray(v.source_agent_result_files);
}

export function validateDecisionsFile(value: unknown): value is DecisionsFile {
  const v = value as DecisionsFile;
  if (!v || typeof v.run_id !== 'string' || typeof v.decided_at !== 'string' || typeof v.findings !== 'object' || v.findings === null) {
    return false;
  }
  return Object.values(v.findings as Record<string, FindingDecision>).every(d => d && isFindingAction(d.action));
}

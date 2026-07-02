export interface Finding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'NOTE';
  file: string;
  line: number;
  location: string;
  finding: string;
  reasoning?: string;
  evidence?: string;
  dimensions?: string[];
  source_agents?: string[];
}
export interface FileEntry { path: string; diff: string; add?: number; del?: number; }
export interface PullRequestInfo {
  number?: number;
  title?: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
}
export interface ReviewerResult {
  agent: string;
  status: 'complete' | 'failed';
  error?: string | null;
  findings: Finding[];
  startedAt?: string;
  completedAt?: string;
}
export interface ReviewData {
  verdict: string;
  findings: Finding[];
  files?: FileEntry[];
  reviewerResults?: ReviewerResult[];
  summary: string;
  timestamp: string;
  branch: string;
  sessionId: string;
  repoLabel?: string;
  runId?: string;
  synthesisStatus?: string;
  resumeCommand?: string;
  recommendedNextActions?: string[];
  pr?: PullRequestInfo | null;
}

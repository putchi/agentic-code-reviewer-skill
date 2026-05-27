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
export interface ReviewData {
  verdict: string;
  findings: Finding[];
  files?: FileEntry[];
  summary: string;
  timestamp: string;
  branch: string;
  sessionId: string;
  runId?: string;
  synthesisStatus?: string;
  resumeCommand?: string;
  recommendedNextActions?: string[];
}

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
}
export interface FileEntry { path: string; diff: string; }
export interface ReviewData {
  verdict: string;
  findings: Finding[];
  files?: FileEntry[];
  summary: string;
  timestamp: string;
  branch: string;
  sessionId: string;
}

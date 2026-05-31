export interface LineAnnotation {
  file: string; lineStart: number; lineEnd: number;
  side: 'new' | 'old'; text: string; linesText: string;
  type: 'COMMENT' | 'REDLINE' | 'LABEL';
}
export interface EditorAnnotation {
  id: string;
  filePath: string;
  selectedText: string;
  lineStart: number;
  lineEnd: number;
  comment?: string;
  createdAt: number;
}
export const FINDING_ACTIONS = [
  'accept_fix',
  'ignore',
  'create_follow_up_task',
  'ask_claude_to_explain',
  'ask_claude_to_implement',
] as const;
export type FindingAction = typeof FINDING_ACTIONS[number];
export interface FindingDecision {
  action: FindingAction;
  comment?: string;
}
export interface DecisionsFile {
  run_id: string;
  decided_at: string;
  global_comment?: string;
  findings: Record<string, FindingDecision>;
  line_annotations?: Record<string, LineAnnotation>;
}
export interface DecisionPayload {
  action?: 'implement' | 'save' | 'done';
  runId?: string;
  findingDecisions?: Record<string, FindingDecision>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  comments?: Record<string, string>;
  selectedIds?: string[];
  dismissedIds?: string[];
  dismissReasons?: Record<string, string>;
}

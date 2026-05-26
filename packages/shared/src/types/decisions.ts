export interface LineAnnotation {
  file: string; lineStart: number; lineEnd: number;
  side: 'new' | 'old'; text: string; linesText: string;
  type: 'COMMENT' | 'REDLINE' | 'LABEL';
}
export interface DecisionPayload {
  action: 'implement' | 'save' | 'done';
  selectedIds: string[];
  comments: Record<string, string>;
  globalComment: string;
  lineAnnotations: Record<string, LineAnnotation>;
  dismissedIds: string[];
  dismissReasons: Record<string, string>;
}

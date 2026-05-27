import type { DecisionPayload, FindingAction, FindingDecision, LineAnnotation } from './decisions';

export interface BuildPayloadParams {
  checkedIds?: Set<string>;
  findingActions?: Record<string, FindingAction | '' | null | undefined>;
  comments: Record<string, string>;
  lineAnnotations: Record<string, LineAnnotation>;
  dismissedIds?: Set<string>;
  dismissReasons?: Record<string, string>;
  runId?: string;
}

export function buildDecisionPayload(params: BuildPayloadParams): Omit<DecisionPayload, 'action'> {
  const { checkedIds = new Set<string>(), comments, lineAnnotations, dismissedIds = new Set<string>(), dismissReasons = {}, runId } = params;
  const commentMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(comments)) {
    if (k.startsWith('_comment_') && v) commentMap[k.slice(9)] = v;
    else if (k !== '_global' && v) commentMap[k] = v;
  }

  const findingDecisions: Record<string, FindingDecision> = {};
  if (params.findingActions) {
    for (const [id, action] of Object.entries(params.findingActions)) {
      if (!action) continue;
      findingDecisions[id] = { action, comment: commentMap[id] || undefined };
    }
  } else {
    for (const id of checkedIds) {
      findingDecisions[id] = { action: 'ask_claude_to_implement', comment: commentMap[id] || undefined };
    }
    for (const id of dismissedIds) {
      findingDecisions[id] = { action: 'ignore', comment: dismissReasons[id] || commentMap[id] || undefined };
    }
  }
  return {
    runId,
    findingDecisions,
    globalComment: comments['_global'] || '',
    lineAnnotations,
    comments: commentMap,
    selectedIds: Array.from(checkedIds),
    dismissedIds: Array.from(dismissedIds),
    dismissReasons,
  };
}

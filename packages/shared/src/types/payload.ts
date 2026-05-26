import type { DecisionPayload, LineAnnotation } from './decisions';

export interface BuildPayloadParams {
  checkedIds: Set<string>;
  comments: Record<string, string>;
  lineAnnotations: Record<string, LineAnnotation>;
  dismissedIds: Set<string>;
  dismissReasons: Record<string, string>;
}

export function buildDecisionPayload(params: BuildPayloadParams): Omit<DecisionPayload, 'action'> {
  const { checkedIds, comments, lineAnnotations, dismissedIds, dismissReasons } = params;
  const selectedIds = Array.from(checkedIds);
  const commentMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(comments)) {
    if (k.startsWith('_comment_') && v) commentMap[k.slice(9)] = v;
  }
  return {
    selectedIds,
    comments: commentMap,
    globalComment: comments['_global'] || '',
    lineAnnotations,
    dismissedIds: Array.from(dismissedIds),
    dismissReasons,
  };
}

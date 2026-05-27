import type { DecisionsFile, FindingAction } from './decisions';

export type ResumeBuckets = Record<FindingAction, string[]>;

export function bucketDecisionActions(decisions: DecisionsFile): ResumeBuckets {
  const buckets: ResumeBuckets = {
    accept_fix: [],
    ignore: [],
    create_follow_up_task: [],
    ask_claude_to_explain: [],
    ask_claude_to_implement: [],
  };
  for (const [id, decision] of Object.entries(decisions.findings)) {
    buckets[decision.action].push(id);
  }
  return buckets;
}

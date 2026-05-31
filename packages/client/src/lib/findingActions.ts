import type { FindingAction } from '@acr/shared';

export const ACTION_OPTIONS: Array<{ value: FindingAction; label: string }> = [
  { value: 'accept_fix', label: 'Accept fix' },
  { value: 'ignore', label: 'Ignore' },
  { value: 'create_follow_up_task', label: 'Follow-up task' },
  { value: 'ask_claude_to_explain', label: 'Ask host agent to explain' },
  { value: 'ask_claude_to_implement', label: 'Ask host agent to implement' },
];

export function actionLabel(action: FindingAction | '' | null | undefined): string {
  return ACTION_OPTIONS.find(option => option.value === action)?.label ?? 'No action';
}

export function isImplementAction(action: FindingAction | '' | null | undefined): boolean {
  return action === 'ask_claude_to_implement' || action === 'accept_fix';
}

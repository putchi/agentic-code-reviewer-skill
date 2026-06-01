import { z } from 'zod';

export const FINDING_ACTIONS_ENUM = [
  'accept_fix',
  'ignore',
  'create_follow_up_task',
  'ask_claude_to_explain',
  'ask_claude_to_implement',
] as const;

export const FindingActionSchema = z.enum(FINDING_ACTIONS_ENUM);

export const FindingDecisionSchema = z.object({
  action: FindingActionSchema,
  comment: z.string().optional(),
});

export const DecisionsFileSchema = z.object({
  run_id: z.string(),
  decided_at: z.string(),
  global_comment: z.string().optional(),
  findings: z.record(FindingDecisionSchema),
  line_annotations: z.record(z.unknown()).optional(),
});

export function zodValidateDecisionsFile(value: unknown): { success: boolean; data?: z.infer<typeof DecisionsFileSchema>; error?: z.ZodError } {
  const result = DecisionsFileSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

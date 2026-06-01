import { z } from 'zod';

export const REVIEW_AGENTS_ENUM = [
  'semantic-analyzer',
  'security-scanner',
  'architecture-reviewer',
  'test-coverage-analyzer',
  'senior-dev-reviewer',
] as const;

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH']),
  file: z.string(),
  line: z.number(),
  location: z.string(),
  finding: z.string(),
  reasoning: z.string().optional(),
  evidence: z.string().optional(),
  confidence: z.number().optional(),
  source_agents: z.array(z.string()).optional(),
});

export const RawReviewerResultSchema = z.object({
  run_id: z.string(),
  agent: z.enum(REVIEW_AGENTS_ENUM),
  status: z.enum(['complete', 'failed']),
  started_at: z.string(),
  completed_at: z.string(),
  error: z.string().nullable(),
  findings: z.array(FindingSchema),
});

export function zodValidateRawReviewerResult(value: unknown): { success: boolean; data?: z.infer<typeof RawReviewerResultSchema>; error?: z.ZodError } {
  const result = RawReviewerResultSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

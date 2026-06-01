import { z } from 'zod';

export const SynthesisFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'NOTE']),
  file: z.string(),
  line: z.number(),
  location: z.string(),
  finding: z.string(),
  reasoning: z.string().optional(),
  evidence: z.string().optional(),
  dimensions: z.array(z.string()).optional(),
  source_agents: z.array(z.string()),
});

export const SynthesisResultSchema = z.object({
  run_id: z.string(),
  two_sentence_verdict: z.string().min(1),
  deduped_findings: z.array(SynthesisFindingSchema),
  dropped_findings_with_reason: z.array(z.unknown()),
  contradictions_resolved: z.array(z.unknown()),
  severity_rationale: z.record(z.string()),
  recommended_next_actions: z.array(z.string()),
  source_agent_result_files: z.array(z.string()),
});

export function zodValidateSynthesisResult(value: unknown): { success: boolean; data?: z.infer<typeof SynthesisResultSchema>; error?: z.ZodError } {
  const result = SynthesisResultSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

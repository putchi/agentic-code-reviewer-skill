import { readFileSync } from 'node:fs';
import type { ReviewData } from '@acr/shared';
import { findingsFile, sessionId } from './config';
export function readFindings(): ReviewData {
  try { return JSON.parse(readFileSync(findingsFile, 'utf8')); }
  catch {
    return { verdict: '', findings: [], files: [], summary: '',
             timestamp: new Date().toISOString(), branch: '', sessionId };
  }
}

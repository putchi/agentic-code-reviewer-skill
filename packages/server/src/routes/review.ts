import { readFindings } from '../findings';
export function handleReview(): Response { return Response.json(readFindings()); }

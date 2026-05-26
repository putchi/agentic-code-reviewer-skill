import { useEffect, useState } from 'react';
import type { ReviewData } from '@acr/shared';
import { fetchReview } from '../lib/api';
export function useReviewData() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchReview().then(setData).catch(e => setError(e.message)); }, []);
  return { data, isLoading: !data && !error, error };
}

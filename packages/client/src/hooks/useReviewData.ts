import { useEffect, useState } from 'react';
import type { ReviewData } from '@acr/shared';
import { fetchReview } from '../lib/api';

const RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export function useReviewData() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let lastError = 'failed to load review';
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
          const review = await fetchReview();
          if (!cancelled) setData(review);
          return;
        } catch (e: any) {
          lastError = e?.message || String(e);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
      if (!cancelled) {
        setError(`${lastError} — the review server may have shut down (idle timeout). Re-open it with /review-last.`);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return { data, isLoading: !data && !error, error };
}

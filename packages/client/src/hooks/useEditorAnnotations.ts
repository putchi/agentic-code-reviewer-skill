import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorAnnotation } from '@acr/shared';

declare global {
  interface Window {
    __ACR_VSCODE?: boolean;
  }
}

const POLL_INTERVAL = 500;

function isVSCodeWebview(): boolean {
  return typeof window !== 'undefined' && window.__ACR_VSCODE === true;
}

export function useEditorAnnotations() {
  const [annotations, setAnnotations] = useState<EditorAnnotation[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAnnotations = useCallback(async () => {
    try {
      const res = await fetch('/api/editor-annotations');
      if (!res.ok) return;
      const data = await res.json();
      const incoming: EditorAnnotation[] = data.annotations ?? [];
      setAnnotations(prev => {
        if (prev.length === incoming.length && prev.every((a, i) => a.id === incoming[i].id)) return prev;
        return incoming;
      });
    } catch {
      // The next poll will retry.
    }
  }, []);

  useEffect(() => {
    if (!isVSCodeWebview()) return;
    fetchAnnotations();
    intervalRef.current = setInterval(fetchAnnotations, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchAnnotations]);

  const deleteEditorAnnotation = useCallback(async (id: string) => {
    if (!isVSCodeWebview()) return;
    try {
      await fetch(`/api/editor-annotation?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } catch {
      // The next poll will reconcile.
    }
  }, []);

  return { editorAnnotations: annotations, deleteEditorAnnotation };
}

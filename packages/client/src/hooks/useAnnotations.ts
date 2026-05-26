import { useLocalStorage } from './useLocalStorage';
import type { LineAnnotation } from '@acr/shared';
import { annotKey } from '../lib/annotKey';

export type AnnotMode = 'markup' | 'comment' | 'redline' | 'quickLabel';

export interface Selection {
  file: string;
  lineStart: number;
  lineEnd: number;
  side: 'new' | 'old';
  linesText: string;
}

export function useAnnotations() {
  const [annotations, setAnnotations] = useLocalStorage<Record<string, LineAnnotation>>(
    'acr-line-annotations', {}
  );

  function addAnnotation(sel: Selection, type: LineAnnotation['type'], text: string) {
    const key = annotKey(sel.file, sel.lineStart, sel.lineEnd, sel.side);
    setAnnotations(prev => ({
      ...prev,
      [key]: { file: sel.file, lineStart: sel.lineStart, lineEnd: sel.lineEnd, side: sel.side, type, text, linesText: sel.linesText },
    }));
  }

  function removeAnnotation(key: string) {
    setAnnotations(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  return { annotations, addAnnotation, removeAnnotation };
}

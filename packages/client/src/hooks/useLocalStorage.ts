import { useEffect, useState } from 'react';
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T|((p:T)=>T))=>void] {
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : JSON.parse(raw); }
    catch { console.warn(`[ACR] corrupted localStorage for "${key}", using defaults`); return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { console.warn(`[ACR] could not persist "${key}" to localStorage:`, e); }
  }, [key, val]);
  return [val, setVal];
}

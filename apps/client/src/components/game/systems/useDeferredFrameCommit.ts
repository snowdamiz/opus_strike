import { useCallback, useEffect, useRef } from 'react';

export function useDeferredFrameCommit<T>(commit: (value: T) => void): (value: T) => void {
  const pendingRef = useRef<T | null>(null);
  const hasPendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    hasPendingRef.current = false;
  }, []);

  return useCallback((value: T) => {
    pendingRef.current = value;
    hasPendingRef.current = true;
    if (timerRef.current !== null) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!hasPendingRef.current) return;
      const nextValue = pendingRef.current as T;
      pendingRef.current = null;
      hasPendingRef.current = false;
      commit(nextValue);
    }, 0);
  }, [commit]);
}

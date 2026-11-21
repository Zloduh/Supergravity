import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebouncedValue(value);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return delayMs <= 0 ? value : debouncedValue;
}

export interface DebouncedCallback<T extends (...args: never[]) => unknown> {
  debounced: (...args: Parameters<T>) => void;
  cancel: () => void;
  flush: () => void;
}

export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  delayMs: number
): DebouncedCallback<T> {
  const callbackRef = useRef<T>(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastArgsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastArgsRef.current !== null) {
      const args = lastArgsRef.current;
      lastArgsRef.current = null;
      callbackRef.current(...args);
    }
  }, []);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      lastArgsRef.current = args;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      if (delayMs <= 0) {
        lastArgsRef.current = null;
        callbackRef.current(...args);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = lastArgsRef.current;
        lastArgsRef.current = null;
        if (pending !== null) {
          callbackRef.current(...pending);
        }
      }, delayMs);
    },
    [delayMs]
  );

  useEffect(() => cancel, [cancel]);

  return { debounced, cancel, flush };
}

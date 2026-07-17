/**
 * useAutoDismiss — starts a countdown timer that calls `onDismiss` after `ms`
 * milliseconds. The timer pauses while the user hovers over the target element
 * and resumes when the pointer leaves.
 *
 * Returns `{ onMouseEnter, onMouseLeave }` event handlers to spread onto the
 * banner/container element.
 */
import { useEffect, useRef, useCallback } from "react";

export function useAutoDismiss(
  ms: number | undefined,
  onDismiss: (() => void) | undefined,
): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const remainingRef = useRef<number>(ms ?? 0);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((delay: number) => {
    cancel();
    if (!delay || delay <= 0) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dismissRef.current?.();
    }, delay);
  }, [cancel]);

  useEffect(() => {
    if (!ms || !onDismiss) return;
    remainingRef.current = ms;
    start(ms);
    return cancel;
  }, [ms, onDismiss, start, cancel]);

  const onMouseEnter = useCallback(() => {
    // Cancel the running timer and reset remaining time to the full duration
    // so the user always gets a fresh countdown after hovering.
    cancel();
    startedAtRef.current = null;
    remainingRef.current = ms ?? 0;
  }, [cancel, ms]);

  const onMouseLeave = useCallback(() => {
    if (remainingRef.current > 0) {
      start(remainingRef.current);
    }
  }, [start]);

  return { onMouseEnter, onMouseLeave };
}

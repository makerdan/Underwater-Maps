import { useEffect } from "react";

/**
 * Captures the currently-focused element at mount time and restores focus to
 * it when the component unmounts (i.e. when the dialog closes via any path:
 * confirm, cancel, or Escape).
 *
 * Call this at the top level of any modal / dialog component. It works
 * independently of useFocusTrap — they can coexist without conflict.
 */
export function useReturnFocus(): void {
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    return () => {
      trigger?.focus();
    };
  }, []);
}

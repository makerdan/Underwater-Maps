---
name: Error boundary retry must use componentDidCatch
description: Why componentDidUpdate's prevState check fails for retry scheduling in React error boundaries, and the correct fix.
---

# Error boundary retry must use componentDidCatch

## The rule
When building a React error boundary with retry-on-failure logic, schedule the retry timer in `componentDidCatch`, not `componentDidUpdate`.

## Why
`componentDidUpdate(prevProps, prevState)` receives the state from the **previous render** as `prevState`. Once an error boundary has caught one error, `prevState.hasError` is `true`. If the boundary resets itself (sets `hasError: false`) and the children throw again during the retry render, `getDerivedStateFromError` fires and sets `hasError: true` again. But when `componentDidUpdate` runs after that, `prevState.hasError` is still `true` (the pre-reset render's state), so the condition `!prevState.hasError && this.state.hasError` is always `false` — the retry timer is never scheduled.

`componentDidCatch` is called **every time** React catches a new error from children, including on retry attempts. It reliably detects each new error regardless of previous state.

## How to apply
```tsx
componentDidCatch(_error: Error, _info: React.ErrorInfo): void {
  if (this._retryTimer !== null) return; // guard: don't stack timers
  const { failureCount } = this.state;
  if (failureCount < MAX_RETRIES) {
    const delay = RETRY_DELAYS[failureCount] ?? 8_000;
    this.setState({ retrying: true });
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.setState((s) => ({ hasError: false, failureCount: s.failureCount + 1, retrying: false }));
    }, delay);
  }
}
```

Use `getDerivedStateFromError` only to set `{ hasError: true }` for the render phase. All side-effectful retry logic belongs in `componentDidCatch`.

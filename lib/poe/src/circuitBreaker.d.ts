/**
 * Lightweight in-process circuit breaker for the Poe AI client.
 *
 * States
 * ------
 *   closed   — normal operation; every call goes to Poe
 *   open     — Poe has been failing; calls fail immediately for `resetMs`
 *   half-open — one probe call is allowed; success closes, failure re-opens
 *
 * State transitions are logged with a distinct `code` field so they surface
 * in dashboards without drowning out application logs.
 */
export interface CircuitBreakerLogger {
    warn(obj: Record<string, unknown>, msg: string): void;
    info(obj: Record<string, unknown>, msg: string): void;
}
type CircuitState = "closed" | "open" | "half-open";
export interface PoeCircuitBreakerOptions {
    /** Consecutive failures required to open the circuit. Default 5. */
    failureThreshold?: number;
    /** Milliseconds to stay open before probing with a half-open request. Default 30 000. */
    resetMs?: number;
    logger?: CircuitBreakerLogger;
}
export declare class PoeCircuitBreaker {
    private state;
    private consecutiveFailures;
    private openedAt;
    private readonly failureThreshold;
    private readonly resetMs;
    private readonly log;
    constructor(opts?: PoeCircuitBreakerOptions);
    /**
     * Returns `true` when the breaker is open and callers should skip the Poe
     * call immediately. Automatically transitions open → half-open after
     * `resetMs` to allow a single probe request through.
     */
    isOpen(): boolean;
    /**
     * Call after a successful Poe response. Closes the circuit if it was
     * open or half-open, and resets the failure counter.
     */
    recordSuccess(): void;
    /**
     * Call after a Poe failure (all retries exhausted). Increments the
     * consecutive-failure counter and opens the circuit when the threshold is
     * reached. A failure while half-open re-opens immediately.
     */
    recordFailure(): void;
    /** Expose current state for observability (e.g. deep health check). */
    getState(): CircuitState;
    /**
     * TEST-ONLY — immediately opens the circuit without going through the
     * normal failure-accumulation path. Use this in tests to avoid the wall-clock
     * time cost of exhausting `failureThreshold` retried requests.
     * Never call this in production code.
     */
    forceOpen(): void;
    private transitionTo;
}
export {};

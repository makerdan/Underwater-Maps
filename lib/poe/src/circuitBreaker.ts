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

const consoleLogger: CircuitBreakerLogger = {
  warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", ...obj, msg })),
  info: (obj, msg) => console.info(JSON.stringify({ level: "info", ...obj, msg })),
};

type CircuitState = "closed" | "open" | "half-open";

export interface PoeCircuitBreakerOptions {
  /** Consecutive failures required to open the circuit. Default 5. */
  failureThreshold?: number;
  /** Milliseconds to stay open before probing with a half-open request. Default 30 000. */
  resetMs?: number;
  logger?: CircuitBreakerLogger;
}

export class PoeCircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly log: CircuitBreakerLogger;

  constructor(opts: PoeCircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetMs ?? 30_000;
    this.log = opts.logger ?? consoleLogger;
  }

  /**
   * Returns `true` when the breaker is open and callers should skip the Poe
   * call immediately. Automatically transitions open → half-open after
   * `resetMs` to allow a single probe request through.
   */
  isOpen(): boolean {
    if (this.state === "closed") return false;

    if (this.state === "open") {
      if (Date.now() - (this.openedAt ?? 0) >= this.resetMs) {
        this.transitionTo("half-open");
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Call after a successful Poe response. Closes the circuit if it was
   * open or half-open, and resets the failure counter.
   */
  recordSuccess(): void {
    if (this.state !== "closed") {
      this.transitionTo("closed");
    }
    this.consecutiveFailures = 0;
  }

  /**
   * Call after a Poe failure (all retries exhausted). Increments the
   * consecutive-failure counter and opens the circuit when the threshold is
   * reached. A failure while half-open re-opens immediately.
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    if (
      this.state === "half-open" ||
      (this.state === "closed" && this.consecutiveFailures >= this.failureThreshold)
    ) {
      this.transitionTo("open");
    }
  }

  /** Expose current state for observability (e.g. deep health check). */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * TEST-ONLY — immediately opens the circuit without going through the
   * normal failure-accumulation path. Use this in tests to avoid the wall-clock
   * time cost of exhausting `failureThreshold` retried requests.
   * Never call this in production code.
   */
  forceOpen(): void {
    this.consecutiveFailures = this.failureThreshold;
    this.transitionTo("open");
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state;
    this.state = next;

    if (next === "open") {
      this.openedAt = Date.now();
      this.log.warn(
        {
          code: "poe_circuit_open",
          from: prev,
          consecutiveFailures: this.consecutiveFailures,
          resetMs: this.resetMs,
        },
        "Poe circuit breaker opened — failing immediately for the next window",
      );
    } else if (next === "closed") {
      this.consecutiveFailures = 0;
      this.openedAt = null;
      this.log.info(
        { code: "poe_circuit_closed", from: prev },
        "Poe circuit breaker closed — resuming normal operation",
      );
    } else if (next === "half-open") {
      this.log.info(
        { code: "poe_circuit_half_open", from: prev },
        "Poe circuit breaker half-open — allowing one probe request",
      );
    }
  }
}

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
const consoleLogger = {
    warn: (obj, msg) => console.warn(JSON.stringify({ level: "warn", ...obj, msg })),
    info: (obj, msg) => console.info(JSON.stringify({ level: "info", ...obj, msg })),
};
export class PoeCircuitBreaker {
    state = "closed";
    consecutiveFailures = 0;
    openedAt = null;
    failureThreshold;
    resetMs;
    log;
    constructor(opts = {}) {
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.resetMs = opts.resetMs ?? 30_000;
        this.log = opts.logger ?? consoleLogger;
    }
    /**
     * Returns `true` when the breaker is open and callers should skip the Poe
     * call immediately. Automatically transitions open → half-open after
     * `resetMs` to allow a single probe request through.
     */
    isOpen() {
        if (this.state === "closed")
            return false;
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
    recordSuccess() {
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
    recordFailure() {
        this.consecutiveFailures++;
        if (this.state === "half-open" ||
            (this.state === "closed" && this.consecutiveFailures >= this.failureThreshold)) {
            this.transitionTo("open");
        }
    }
    /** Expose current state for observability (e.g. deep health check). */
    getState() {
        return this.state;
    }
    transitionTo(next) {
        const prev = this.state;
        this.state = next;
        if (next === "open") {
            this.openedAt = Date.now();
            this.log.warn({
                code: "poe_circuit_open",
                from: prev,
                consecutiveFailures: this.consecutiveFailures,
                resetMs: this.resetMs,
            }, "Poe circuit breaker opened — failing immediately for the next window");
        }
        else if (next === "closed") {
            this.consecutiveFailures = 0;
            this.openedAt = null;
            this.log.info({ code: "poe_circuit_closed", from: prev }, "Poe circuit breaker closed — resuming normal operation");
        }
        else if (next === "half-open") {
            this.log.info({ code: "poe_circuit_half_open", from: prev }, "Poe circuit breaker half-open — allowing one probe request");
        }
    }
}

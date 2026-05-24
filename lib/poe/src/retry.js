import { PoeCreditsError, mapHttpStatusToError } from "./errors.js";
const RETRY_DELAYS_MS = [1000, 2000, 4000];
function isOpenAIError(err) {
    return (typeof err === "object" &&
        err !== null &&
        "status" in err &&
        typeof err.status === "number");
}
export async function withRetry(fn, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (isOpenAIError(err)) {
                const status = err.status;
                if (status === 402) {
                    throw new PoeCreditsError();
                }
                if (status === 401) {
                    throw mapHttpStatusToError(401, err.message);
                }
                if (status === 400) {
                    throw mapHttpStatusToError(400, err.message);
                }
                if (status === 429 && attempt < maxRetries) {
                    const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
                    await sleep(delay);
                    continue;
                }
                if (status >= 500 && attempt < maxRetries) {
                    const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
                    await sleep(delay);
                    continue;
                }
                throw mapHttpStatusToError(status, err.message);
            }
            if (attempt < maxRetries) {
                const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

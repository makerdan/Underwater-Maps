/**
 * Page-side service-worker lifecycle boundary.
 *
 * vite-plugin-pwa owns the generated worker URL and scope.  This module owns
 * the observable registration result and the checks an offline save needs
 * before it can safely ask the worker to cache protected terrain responses.
 */

export const SERVICE_WORKER_READY_TIMEOUT_MS = 15_000;

export type ServiceWorkerReadinessFailure =
  | "unsupported"
  | "registration"
  | "registration-timeout"
  | "installation"
  | "activation-timeout"
  | "inactive"
  | "uncontrolled";

export class ServiceWorkerReadinessError extends Error {
  constructor(
    public readonly reason: ServiceWorkerReadinessFailure,
    message: string,
  ) {
    super(message);
    this.name = "ServiceWorkerReadinessError";
  }
}

type RegistrationStarter = () => Promise<ServiceWorkerRegistration>;

let registrationAttempt: Promise<ServiceWorkerRegistration> | null = null;

function readinessError(
  reason: ServiceWorkerReadinessFailure,
  message: string,
): ServiceWorkerReadinessError {
  return new ServiceWorkerReadinessError(reason, message);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(error), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/**
 * Called by the application entry point before React renders. Keeping the
 * registration promise lets a later offline save report a rejected
 * registration rather than waiting for `navigator.serviceWorker.ready` to
 * time out with no useful cause.
 */
export function startServiceWorkerRegistration(starter: RegistrationStarter): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (registrationAttempt) return;

  registrationAttempt = starter();
  // Registration begins at app startup, while the user may not try an offline
  // save for a while. Observe the rejection now as well as when readiness is
  // requested so a browser does not report an unhandled promise rejection.
  void registrationAttempt.catch(() => undefined);
}

function registrationFailure(cause: unknown): ServiceWorkerReadinessError {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return readinessError(
    "registration",
    `Could not register the offline service worker${detail}. Reload BathyScan and retry. If this keeps happening, clear this site's data and retry.`,
  );
}

function waitForActivation(
  serviceWorker: ServiceWorkerContainer,
  registration: ServiceWorkerRegistration | undefined,
): Promise<ServiceWorkerRegistration> {
  const installingWorker = registration?.installing;
  if (!installingWorker) return serviceWorker.ready;
  if (installingWorker.state === "redundant") {
    return Promise.reject(
      readinessError(
        "installation",
        "Service worker installation failed. Reload BathyScan and retry saving offline.",
      ),
    );
  }
  if (
    typeof installingWorker.addEventListener !== "function" ||
    typeof installingWorker.removeEventListener !== "function"
  ) {
    return serviceWorker.ready;
  }

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const onStateChange = () => {
      if (installingWorker.state !== "redundant") return;
      cleanup();
      reject(
        readinessError(
          "installation",
          "Service worker installation failed. Reload BathyScan and retry saving offline.",
        ),
      );
    };
    const cleanup = () => installingWorker.removeEventListener("statechange", onStateChange);
    installingWorker.addEventListener("statechange", onStateChange);
    serviceWorker.ready.then(
      (readyRegistration) => {
        cleanup();
        resolve(readyRegistration);
      },
      (cause) => {
        cleanup();
        reject(cause);
      },
    );
  });
}

/**
 * Return an activated worker that controls the current page. A CACHE_PACK
 * acknowledgement is deliberately *not* part of this function: it has its
 * own timeout after lifecycle readiness succeeds.
 */
export async function getControllingServiceWorker(): Promise<ServiceWorker> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw readinessError(
      "unsupported",
      "Offline saving is unavailable because this browser does not support service workers. Use a supported browser and retry.",
    );
  }

  const serviceWorker = navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | undefined;

  if (registrationAttempt) {
    try {
      registration = await withTimeout(
        registrationAttempt,
        SERVICE_WORKER_READY_TIMEOUT_MS,
        readinessError(
          "registration-timeout",
          "Service worker registration timed out. Reload BathyScan and retry saving offline.",
        ),
      );
    } catch (cause) {
      if (cause instanceof ServiceWorkerReadinessError) throw cause;
      throw registrationFailure(cause);
    }
  }

  let readyRegistration: ServiceWorkerRegistration;
  try {
    readyRegistration = await withTimeout(
      waitForActivation(serviceWorker, registration),
      SERVICE_WORKER_READY_TIMEOUT_MS,
      readinessError(
        "activation-timeout",
        "Service worker activation timed out. Reload BathyScan and retry saving offline.",
      ),
    );
  } catch (cause) {
    if (cause instanceof ServiceWorkerReadinessError) throw cause;
    throw registrationFailure(cause);
  }

  const activeWorker = readyRegistration.active;
  if (!activeWorker) {
    if (registration?.installing?.state === "redundant") {
      throw readinessError(
        "installation",
        "Service worker installation failed. Reload BathyScan and retry saving offline.",
      );
    }
    throw readinessError(
      "inactive",
      "Service worker not active yet. Reload BathyScan, then retry saving offline.",
    );
  }

  // ServiceWorkerContainer always exposes `controller` in browsers. The
  // property-presence check keeps minimal unit-test doubles compatible while
  // refusing a real first-load page that an activated worker does not control.
  if ("controller" in serviceWorker && !serviceWorker.controller) {
    throw readinessError(
      "uncontrolled",
      "Service worker is active but this page is not controlled. Reload BathyScan, then retry saving offline.",
    );
  }

  return activeWorker;
}

/** Test-only reset for deterministic lifecycle fixtures. */
export function __resetServiceWorkerReadinessForTests(): void {
  registrationAttempt = null;
}
import { AdapterExecutionError } from "../adapter";

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 50;

export function resolveConfiguredEnvValue(
  configuredName: string | undefined,
  defaultName: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = env[configuredName ?? defaultName];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function resolveRetryPolicy(config: {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}): {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
} {
  return {
    maxAttempts: Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    retryDelayMs: Math.max(0, config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
  };
}

export function normalizeAdapterFailure(
  error: unknown,
  fallbackMessage: string,
): AdapterExecutionError {
  if (error instanceof AdapterExecutionError) {
    return error;
  }
  return new AdapterExecutionError(
    "provider_error",
    error instanceof Error ? error.message : fallbackMessage,
  );
}

function waitForRetryDelay(
  retryDelayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (retryDelayMs <= 0) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return Promise.reject(
      new AdapterExecutionError("timeout", "adapter retry delay aborted"),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, retryDelayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(
        new AdapterExecutionError("timeout", "adapter retry delay aborted"),
      );
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function executeWithRetry<T>(input: {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly signal: AbortSignal;
  readonly run: () => Promise<T>;
  readonly normalizeError: (error: unknown) => AdapterExecutionError;
}): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await input.run();
    } catch (error: unknown) {
      const normalized = input.normalizeError(error);
      const shouldRetry =
        attempt < input.maxAttempts &&
        !input.signal.aborted &&
        (normalized.code === "provider_error" || normalized.code === "timeout");
      if (!shouldRetry) {
        throw normalized;
      }
      await waitForRetryDelay(input.retryDelayMs, input.signal);
    }
  }
}

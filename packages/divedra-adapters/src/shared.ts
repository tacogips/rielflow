import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  normalizeTextBusinessPayload,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
} from "divedra-core";

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

export async function executeOfficialSdkRequest<TClient>(input: {
  readonly adapterInput: AdapterExecutionInput;
  readonly context: AdapterExecutionContext;
  readonly config: {
    readonly apiKeyEnv?: string;
    readonly baseUrl?: string;
    readonly maxAttempts?: number;
    readonly retryDelayMs?: number;
    readonly clientFactory?: (args: {
      readonly apiKey: string;
      readonly baseURL?: string;
    }) => TClient;
  };
  readonly defaultApiKeyEnv: string;
  readonly missingApiKeyMessage: string;
  readonly clientFactory: (args: {
    readonly apiKey: string;
    readonly baseURL?: string;
  }) => TClient;
  readonly provider: AdapterExecutionOutput["provider"];
  readonly responseLabel: string;
  readonly abortedMessage: string;
  readonly fallbackFailureMessage: string;
  readonly createRequest: (client: TClient) => Promise<unknown>;
  readonly extractText: (response: unknown) => string;
}): Promise<AdapterExecutionOutput> {
  const apiKey = resolveConfiguredEnvValue(
    input.config.apiKeyEnv,
    input.defaultApiKeyEnv,
  );
  if (apiKey === undefined) {
    throw new AdapterExecutionError("policy_blocked", input.missingApiKeyMessage);
  }

  const clientFactory = input.config.clientFactory ?? input.clientFactory;
  const client = clientFactory({
    apiKey,
    ...(input.config.baseUrl === undefined
      ? {}
      : { baseURL: input.config.baseUrl }),
  });
  const { maxAttempts, retryDelayMs } = resolveRetryPolicy(input.config);

  return executeWithRetry({
    maxAttempts,
    retryDelayMs,
    signal: input.context.signal,
    run: async () => {
      const response = await input.createRequest(client);
      const text = input.extractText(response);
      const normalizedPayload =
        input.adapterInput.output === undefined
          ? {
              completionPassed: true,
              when: { always: true },
              payload: normalizeTextBusinessPayload(text),
            }
          : normalizeOutputContractEnvelope(
              parseJsonObjectCandidate(text, input.responseLabel),
              input.responseLabel,
            );
      return {
        provider: input.provider,
        model: input.adapterInput.node.model,
        promptText: input.adapterInput.promptText,
        completionPassed: normalizedPayload.completionPassed,
        when: normalizedPayload.when,
        payload: normalizedPayload.payload,
      };
    },
    normalizeError: (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return new AdapterExecutionError("timeout", input.abortedMessage);
      }
      if (input.context.signal.aborted) {
        return new AdapterExecutionError("timeout", input.abortedMessage);
      }
      return normalizeAdapterFailure(error, input.fallbackFailureMessage);
    },
  });
}

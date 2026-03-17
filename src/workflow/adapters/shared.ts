import { AdapterExecutionError, type AdapterExecutionInput } from "../adapter";

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

export function buildRemoteAgentRequestBody(
  input: AdapterExecutionInput,
): Record<string, unknown> {
  return {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    model: input.node.model,
    promptText: input.promptText,
    arguments: input.arguments,
    mergedVariables: input.mergedVariables,
    executionIndex: input.executionIndex,
    ...(input.output === undefined ? { artifactDir: input.artifactDir } : {}),
    upstreamCommunicationIds: input.upstreamCommunicationIds,
    ...(input.backendSession === undefined
      ? {}
      : { backendSession: input.backendSession }),
    ...(input.ambientManagerContext === undefined
      ? {}
      : { ambientManagerContext: input.ambientManagerContext }),
    ...(input.output === undefined ? {} : { output: input.output }),
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
      if (input.retryDelayMs > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, input.retryDelayMs),
        );
      }
    }
  }
}

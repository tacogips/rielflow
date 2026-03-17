import {
  AdapterExecutionError,
  normalizeAdapterOutput,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterExecutionContext,
  type NodeAdapter,
} from "../adapter";
import {
  buildRemoteAgentRequestBody,
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

const DEFAULT_CODEX_ENDPOINT = "http://127.0.0.1:7070/codex/execute";
const DEFAULT_CODEX_API_KEY_ENV = "CODEX_API_KEY";

export interface CodexAdapterConfig {
  readonly endpoint?: string;
  readonly apiKeyEnv?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

function resolveApiKey(config: CodexAdapterConfig): string | undefined {
  return resolveConfiguredEnvValue(config.apiKeyEnv, DEFAULT_CODEX_API_KEY_ENV);
}

export class CodexAgentAdapter implements NodeAdapter {
  readonly #config: CodexAdapterConfig;

  constructor(config: CodexAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const endpoint = this.#config.endpoint ?? DEFAULT_CODEX_ENDPOINT;
    const apiKey = resolveApiKey(this.#config);
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (apiKey !== undefined) {
      headers["authorization"] = `Bearer ${apiKey}`;
    }

    return executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: context.signal,
          body: JSON.stringify(buildRemoteAgentRequestBody(input)),
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new AdapterExecutionError(
              "policy_blocked",
              `codex adapter request blocked (${response.status})`,
            );
          }
          if (response.status === 408 || response.status === 504) {
            throw new AdapterExecutionError(
              "timeout",
              `codex adapter request timeout (${response.status})`,
            );
          }
          throw new AdapterExecutionError(
            "provider_error",
            `codex adapter request failed (${response.status})`,
          );
        }

        const payload = (await response.json()) as unknown;
        return normalizeAdapterOutput(payload, input.node.model);
      },
      normalizeError: (error) =>
        error instanceof DOMException && error.name === "AbortError"
          ? new AdapterExecutionError(
              "timeout",
              "codex adapter aborted by timeout",
            )
          : normalizeAdapterFailure(error, "unknown codex adapter failure"),
    });
  }
}

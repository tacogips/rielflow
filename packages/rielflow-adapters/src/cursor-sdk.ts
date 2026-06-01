import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  normalizeTextBusinessPayload,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "rielflow-core";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

const DEFAULT_CURSOR_API_KEY_ENV = "CURSOR_API_KEY";
const CURSOR_SDK_MODULE_SPECIFIER = "@cursor/sdk";

type CursorAgentOptions = {
  readonly apiKey: string;
  readonly model: { readonly id: string };
  readonly local: { readonly cwd: string };
};

type CursorRunResult = {
  readonly status: string;
  readonly result?: string;
};

interface CursorRunLike {
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
}

interface CursorAgentLike {
  send(message: string): Promise<CursorRunLike>;
  close(): void;
}

interface CursorAgentApi {
  create(options: CursorAgentOptions): Promise<CursorAgentLike>;
}

export interface CursorSdkAdapterConfig {
  readonly apiKeyEnv?: string;
  readonly cwd?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly agentFactory?: (options: CursorAgentOptions) => Promise<CursorAgentLike>;
}

function formatCursorPrompt(input: AdapterExecutionInput): string {
  return input.systemPromptText === undefined
    ? input.promptText
    : `${input.systemPromptText}\n\n${input.promptText}`;
}

async function defaultAgentFactory(
  options: CursorAgentOptions,
): Promise<CursorAgentLike> {
  const { Agent } = (await import(CURSOR_SDK_MODULE_SPECIFIER)) as {
    readonly Agent: CursorAgentApi;
  };
  return await Agent.create(options);
}

function normalizeCursorResult(result: CursorRunResult): string {
  if (result.status !== "finished") {
    throw new AdapterExecutionError(
      "provider_error",
      `Cursor SDK run ended with status '${result.status}'`,
    );
  }
  return result.result ?? "";
}

export class CursorSdkAdapter implements NodeAdapter {
  readonly #config: CursorSdkAdapterConfig;

  constructor(config: CursorSdkAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const apiKey = resolveConfiguredEnvValue(
      this.#config.apiKeyEnv,
      DEFAULT_CURSOR_API_KEY_ENV,
    );
    if (apiKey === undefined) {
      throw new AdapterExecutionError("policy_blocked", "missing Cursor API key");
    }

    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);
    const agentFactory = this.#config.agentFactory ?? defaultAgentFactory;

    return executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        if (context.signal.aborted) {
          throw new AdapterExecutionError(
            "timeout",
            "official Cursor SDK request aborted",
          );
        }

        const agent = await agentFactory({
          apiKey,
          model: { id: input.node.model },
          local: { cwd: this.#config.cwd ?? process.cwd() },
        });

        let run: CursorRunLike | undefined;
        const abortHandler = () => {
          void run?.cancel().catch(() => undefined);
        };
        context.signal.addEventListener("abort", abortHandler, { once: true });

        try {
          run = await agent.send(formatCursorPrompt(input));
          const text = normalizeCursorResult(await run.wait());
          const normalizedPayload =
            input.output === undefined
              ? {
                  completionPassed: true,
                  when: { always: true },
                  payload: normalizeTextBusinessPayload(text),
                }
              : normalizeOutputContractEnvelope(
                  parseJsonObjectCandidate(text, "official Cursor SDK response"),
                  "official Cursor SDK response",
                );
          return {
            provider: "official-cursor-sdk",
            model: input.node.model,
            promptText: input.promptText,
            completionPassed: normalizedPayload.completionPassed,
            when: normalizedPayload.when,
            payload: normalizedPayload.payload,
          };
        } finally {
          context.signal.removeEventListener("abort", abortHandler);
          agent.close();
        }
      },
      normalizeError: (error: unknown) => {
        if (context.signal.aborted) {
          return new AdapterExecutionError(
            "timeout",
            "official Cursor SDK request aborted",
          );
        }
        return normalizeAdapterFailure(error, "unknown Cursor SDK failure");
      },
    });
  }
}

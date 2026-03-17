import OpenAI from "openai";
import {
  AdapterExecutionError,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "../adapter";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

const DEFAULT_OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

interface OpenAiResponsesClient {
  create(
    request: {
      readonly model: string;
      readonly input: string;
    },
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown>;
}

interface OpenAiClientLike {
  readonly responses: OpenAiResponsesClient;
}

export interface OpenAiSdkAdapterConfig {
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly clientFactory?: (args: {
    readonly apiKey: string;
    readonly baseURL?: string;
  }) => OpenAiClientLike;
}

function resolveApiKey(config: OpenAiSdkAdapterConfig): string | undefined {
  return resolveConfiguredEnvValue(
    config.apiKeyEnv,
    DEFAULT_OPENAI_API_KEY_ENV,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOpenAiText(response: unknown): string {
  if (!isRecord(response)) {
    return "";
  }

  const outputText = response["output_text"];
  if (typeof outputText === "string") {
    return outputText;
  }

  const output = response["output"];
  if (!Array.isArray(output)) {
    return "";
  }

  const segments: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    const content = item["content"];
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      if (!isRecord(entry)) {
        continue;
      }
      if (entry["type"] !== "output_text") {
        continue;
      }
      const text = entry["text"];
      if (typeof text === "string" && text.length > 0) {
        segments.push(text);
      }
    }
  }

  return segments.join("\n");
}

function defaultClientFactory(args: {
  readonly apiKey: string;
  readonly baseURL?: string;
}): OpenAiClientLike {
  return new OpenAI({
    apiKey: args.apiKey,
    ...(args.baseURL === undefined ? {} : { baseURL: args.baseURL }),
  }) as unknown as OpenAiClientLike;
}

export class OpenAiSdkAdapter implements NodeAdapter {
  readonly #config: OpenAiSdkAdapterConfig;

  constructor(config: OpenAiSdkAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const apiKey = resolveApiKey(this.#config);
    if (apiKey === undefined) {
      throw new AdapterExecutionError(
        "policy_blocked",
        "missing OpenAI API key",
      );
    }

    const clientFactory = this.#config.clientFactory ?? defaultClientFactory;
    const client = clientFactory({
      apiKey,
      ...(this.#config.baseUrl === undefined
        ? {}
        : { baseURL: this.#config.baseUrl }),
    });
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);

    return executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        const response = await client.responses.create(
          {
            model: input.node.model,
            input: input.promptText,
          },
          {
            signal: context.signal,
          },
        );

        const text = extractOpenAiText(response);
        const payload =
          input.output === undefined
            ? {
                text,
                response: isRecord(response) ? response : {},
              }
            : parseJsonObjectCandidate(text, "official OpenAI SDK response");
        return {
          provider: "official-openai-sdk",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload,
        };
      },
      normalizeError: (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return new AdapterExecutionError(
            "timeout",
            "official OpenAI SDK request aborted",
          );
        }
        if (context.signal.aborted) {
          return new AdapterExecutionError(
            "timeout",
            "official OpenAI SDK request aborted",
          );
        }
        return normalizeAdapterFailure(error, "unknown OpenAI SDK failure");
      },
    });
  }
}

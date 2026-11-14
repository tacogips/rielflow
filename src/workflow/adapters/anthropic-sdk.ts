import Anthropic from "@anthropic-ai/sdk";
import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "../adapter";
import { normalizeTextBusinessPayload } from "../json-boundary";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

const DEFAULT_ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;

interface AnthropicMessagesClient {
  create(
    request: {
      readonly model: string;
      readonly max_tokens: number;
      readonly system?: string;
      readonly messages: ReadonlyArray<{
        readonly role: "user";
        readonly content: string;
      }>;
    },
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown>;
}

interface AnthropicClientLike {
  readonly messages: AnthropicMessagesClient;
}

export interface AnthropicSdkAdapterConfig {
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxTokens?: number;
  readonly clientFactory?: (args: {
    readonly apiKey: string;
    readonly baseURL?: string;
  }) => AnthropicClientLike;
}

function resolveApiKey(config: AnthropicSdkAdapterConfig): string | undefined {
  return resolveConfiguredEnvValue(
    config.apiKeyEnv,
    DEFAULT_ANTHROPIC_API_KEY_ENV,
  );
}

function extractAnthropicText(response: unknown): string {
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    return "";
  }
  const content = (response as Record<string, unknown>)["content"];
  if (!Array.isArray(content)) {
    return "";
  }

  const segments: string[] = [];
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    if ((entry as Record<string, unknown>)["type"] !== "text") {
      continue;
    }
    const text = (entry as Record<string, unknown>)["text"];
    if (typeof text === "string" && text.length > 0) {
      segments.push(text);
    }
  }
  return segments.join("\n");
}

function defaultClientFactory(args: {
  readonly apiKey: string;
  readonly baseURL?: string;
}): AnthropicClientLike {
  return new Anthropic({
    apiKey: args.apiKey,
    ...(args.baseURL === undefined ? {} : { baseURL: args.baseURL }),
  }) as unknown as AnthropicClientLike;
}

export class AnthropicSdkAdapter implements NodeAdapter {
  readonly #config: AnthropicSdkAdapterConfig;

  constructor(config: AnthropicSdkAdapterConfig = {}) {
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
        "missing Anthropic API key",
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
    const maxTokens = Math.max(
      1,
      this.#config.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    );

    return executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        const response = await client.messages.create(
          {
            model: input.node.model,
            max_tokens: maxTokens,
            ...(input.systemPromptText === undefined
              ? {}
              : { system: input.systemPromptText }),
            messages: [{ role: "user", content: input.promptText }],
          },
          {
            signal: context.signal,
          },
        );

        const text = extractAnthropicText(response);
        const normalizedPayload =
          input.output === undefined
            ? {
                completionPassed: true,
                when: { always: true },
                payload: normalizeTextBusinessPayload(text),
              }
            : normalizeOutputContractEnvelope(
                parseJsonObjectCandidate(
                  text,
                  "official Anthropic SDK response",
                ),
                "official Anthropic SDK response",
              );
        return {
          provider: "official-anthropic-sdk",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: normalizedPayload.completionPassed,
          when: normalizedPayload.when,
          payload: normalizedPayload.payload,
        };
      },
      normalizeError: (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return new AdapterExecutionError(
            "timeout",
            "official Anthropic SDK request aborted",
          );
        }
        if (context.signal.aborted) {
          return new AdapterExecutionError(
            "timeout",
            "official Anthropic SDK request aborted",
          );
        }
        return normalizeAdapterFailure(error, "unknown Anthropic SDK failure");
      },
    });
  }
}

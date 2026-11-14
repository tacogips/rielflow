import Anthropic from "@anthropic-ai/sdk";
import {
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "divedra-core";
import {
  executeOfficialSdkRequest,
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
    const maxTokens = Math.max(
      1,
      this.#config.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    );

    return executeOfficialSdkRequest({
      adapterInput: input,
      context,
      config: this.#config,
      defaultApiKeyEnv: DEFAULT_ANTHROPIC_API_KEY_ENV,
      missingApiKeyMessage: "missing Anthropic API key",
      clientFactory: defaultClientFactory,
      provider: "official-anthropic-sdk",
      responseLabel: "official Anthropic SDK response",
      abortedMessage: "official Anthropic SDK request aborted",
      fallbackFailureMessage: "unknown Anthropic SDK failure",
      createRequest: (client) =>
        client.messages.create(
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
        ),
      extractText: extractAnthropicText,
    });
  }
}

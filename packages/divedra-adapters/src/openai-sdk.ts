import OpenAI from "openai";
import {
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "divedra-core";
import {
  executeOfficialSdkRequest,
} from "./shared";

const DEFAULT_OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

interface OpenAiResponsesClient {
  create(
    request: {
      readonly model: string;
      readonly input: string;
      readonly instructions?: string;
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

function extractOpenAiText(response: unknown): string {
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    return "";
  }

  const outputText = (response as Record<string, unknown>)["output_text"];
  if (typeof outputText === "string") {
    return outputText;
  }

  const output = (response as Record<string, unknown>)["output"];
  if (!Array.isArray(output)) {
    return "";
  }

  const segments: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const content = (item as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      if ((entry as Record<string, unknown>)["type"] !== "output_text") {
        continue;
      }
      const text = (entry as Record<string, unknown>)["text"];
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
    return executeOfficialSdkRequest({
      adapterInput: input,
      context,
      config: this.#config,
      defaultApiKeyEnv: DEFAULT_OPENAI_API_KEY_ENV,
      missingApiKeyMessage: "missing OpenAI API key",
      clientFactory: defaultClientFactory,
      provider: "official-openai-sdk",
      responseLabel: "official OpenAI SDK response",
      abortedMessage: "official OpenAI SDK request aborted",
      fallbackFailureMessage: "unknown OpenAI SDK failure",
      createRequest: (client) =>
        client.responses.create(
          {
            model: input.node.model,
            input: input.promptText,
            ...(input.systemPromptText === undefined
              ? {}
              : { instructions: input.systemPromptText }),
          },
          {
            signal: context.signal,
          },
        ),
      extractText: extractOpenAiText,
    });
  }
}

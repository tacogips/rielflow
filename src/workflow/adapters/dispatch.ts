import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "../adapter";
import type { AgentNodePayload, NodeExecutionBackend } from "../types";
import {
  AnthropicSdkAdapter,
  type AnthropicSdkAdapterConfig,
} from "./anthropic-sdk";
import { ClaudeCodeAgentAdapter, type ClaudeAdapterConfig } from "./claude";
import { CodexAgentAdapter, type CodexAdapterConfig } from "./codex";
import { CursorCliAgentAdapter, type CursorAdapterConfig } from "./cursor";
import { OpenAiSdkAdapter, type OpenAiSdkAdapterConfig } from "./openai-sdk";

export interface DispatchingNodeAdapterConfig {
  readonly codexAgent?: CodexAdapterConfig;
  readonly claudeCodeAgent?: ClaudeAdapterConfig;
  readonly cursorCliAgent?: CursorAdapterConfig;
  readonly openAiSdk?: OpenAiSdkAdapterConfig;
  readonly anthropicSdk?: AnthropicSdkAdapterConfig;
}

export function resolveNodeExecutionBackend(
  node: AgentNodePayload,
): NodeExecutionBackend {
  if (node.executionBackend !== undefined) {
    return node.executionBackend;
  }
  throw new AdapterExecutionError(
    "provider_error",
    `node '${node.id}' requires explicit executionBackend`,
  );
}

export class DispatchingNodeAdapter implements NodeAdapter {
  readonly #codexAgent: NodeAdapter;
  readonly #claudeCodeAgent: NodeAdapter;
  readonly #cursorCliAgent: NodeAdapter;
  readonly #openAiSdk: NodeAdapter;
  readonly #anthropicSdk: NodeAdapter;

  constructor(config: DispatchingNodeAdapterConfig = {}) {
    this.#codexAgent = new CodexAgentAdapter(config.codexAgent);
    this.#claudeCodeAgent = new ClaudeCodeAgentAdapter(config.claudeCodeAgent);
    this.#cursorCliAgent = new CursorCliAgentAdapter(config.cursorCliAgent);
    this.#openAiSdk = new OpenAiSdkAdapter(config.openAiSdk);
    this.#anthropicSdk = new AnthropicSdkAdapter(config.anthropicSdk);
  }

  execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    switch (resolveNodeExecutionBackend(input.node)) {
      case "codex-agent":
        return this.#codexAgent.execute(input, context);
      case "claude-code-agent":
        return this.#claudeCodeAgent.execute(input, context);
      case "cursor-cli-agent":
        return this.#cursorCliAgent.execute(input, context);
      case "official/openai-sdk":
        return this.#openAiSdk.execute(input, context);
      case "official/anthropic-sdk":
        return this.#anthropicSdk.execute(input, context);
    }
  }
}

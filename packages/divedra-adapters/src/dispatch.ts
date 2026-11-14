import {
  AdapterExecutionError,
  NODE_EXECUTION_BACKEND,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AgentNodePayload,
  type NodeAdapter,
  type NodeExecutionBackend,
} from "divedra-core";
import type { AnthropicSdkAdapterConfig } from "./anthropic-sdk";
import type { ClaudeAdapterConfig } from "./claude";
import type { CodexAdapterConfig } from "./codex";
import type { CursorAdapterConfig } from "./cursor";
import type { OpenAiSdkAdapterConfig } from "./openai-sdk";

export interface DispatchingNodeAdapterConfig {
  readonly codexAgent?: CodexAdapterConfig;
  readonly claudeCodeAgent?: ClaudeAdapterConfig;
  readonly cursorCliAgent?: CursorAdapterConfig;
  readonly openAiSdk?: OpenAiSdkAdapterConfig;
  readonly anthropicSdk?: AnthropicSdkAdapterConfig;
  readonly registry?: NodeAdapterRegistry;
}

export type NodeAdapterFactory = () => NodeAdapter | Promise<NodeAdapter>;
export type NodeAdapterRegistry = Readonly<
  Partial<Record<NodeExecutionBackend, NodeAdapterFactory>>
>;

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
  readonly #registry: NodeAdapterRegistry;
  readonly #adapters = new Map<NodeExecutionBackend, NodeAdapter>();

  constructor(config: DispatchingNodeAdapterConfig = {}) {
    this.#registry = {
      ...createDefaultNodeAdapterRegistry(config),
      ...(config.registry ?? {}),
    };
  }

  async #loadAdapter(backend: NodeExecutionBackend): Promise<NodeAdapter> {
    const cached = this.#adapters.get(backend);
    if (cached !== undefined) {
      return cached;
    }
    const factory = this.#registry[backend];
    if (factory === undefined) {
      throw new AdapterExecutionError(
        "provider_error",
        `node execution backend '${backend}' has no registered adapter`,
      );
    }
    const adapter = await factory();
    this.#adapters.set(backend, adapter);
    return adapter;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const adapter = await this.#loadAdapter(
      resolveNodeExecutionBackend(input.node),
    );
    return adapter.execute(input, context);
  }
}

function createDefaultNodeAdapterRegistry(
  config: DispatchingNodeAdapterConfig,
): NodeAdapterRegistry {
  return {
    [NODE_EXECUTION_BACKEND.CODEX_AGENT]: async () => {
      const { CodexAgentAdapter } = await import("./codex");
      return new CodexAgentAdapter(config.codexAgent);
    },
    [NODE_EXECUTION_BACKEND.CLAUDE_CODE_AGENT]: async () => {
      const { ClaudeCodeAgentAdapter } = await import("./claude");
      return new ClaudeCodeAgentAdapter(config.claudeCodeAgent);
    },
    [NODE_EXECUTION_BACKEND.CURSOR_CLI_AGENT]: async () => {
      const { CursorCliAgentAdapter } = await import("./cursor");
      return new CursorCliAgentAdapter(config.cursorCliAgent);
    },
    [NODE_EXECUTION_BACKEND.OFFICIAL_OPENAI_SDK]: async () => {
      const { OpenAiSdkAdapter } = await import("./openai-sdk");
      return new OpenAiSdkAdapter(config.openAiSdk);
    },
    [NODE_EXECUTION_BACKEND.OFFICIAL_ANTHROPIC_SDK]: async () => {
      const { AnthropicSdkAdapter } = await import("./anthropic-sdk");
      return new AnthropicSdkAdapter(config.anthropicSdk);
    },
  };
}

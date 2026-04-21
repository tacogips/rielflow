import { pathToFileURL } from "node:url";
import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "../adapter";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  throwIfAborted,
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";

type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

interface ClaudeSessionConfig {
  readonly prompt: string;
  readonly projectPath?: string;
  readonly systemPrompt?: string;
}

interface ClaudeSessionRunnerOptions {
  readonly cwd?: string;
  readonly model?: string;
  readonly permissionMode?: PermissionMode;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

interface ClaudeSessionResult {
  readonly success: boolean;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly toolCallCount: number;
    readonly messageCount: number;
  };
}

interface ClaudeRunningSessionLike {
  readonly sessionId: string;
  messages(): AsyncIterable<object>;
  waitForCompletion(): Promise<ClaudeSessionResult>;
  cancel(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): void;
  removeListener(event: "error", listener: (error: unknown) => void): void;
}

interface ClaudeSessionRunnerLike {
  startSession(config: ClaudeSessionConfig): Promise<ClaudeRunningSessionLike>;
  resumeSession(
    sessionId: string,
    prompt?: string,
    systemPrompt?: string,
  ): Promise<ClaudeRunningSessionLike>;
}

type ClaudeRunnerFactory = (
  options: ClaudeSessionRunnerOptions,
) => ClaudeSessionRunnerLike | Promise<ClaudeSessionRunnerLike>;

export interface ClaudeAdapterConfig {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly cwd?: string;
  readonly permissionMode?: PermissionMode;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: ClaudeRunnerFactory;
}

const importUnknownModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

async function createDefaultRunner(
  options: ClaudeSessionRunnerOptions,
): Promise<ClaudeSessionRunnerLike> {
  const modulePath = pathToFileURL(
    `${process.cwd()}/node_modules/claude-code-agent/src/sdk/agent.ts`,
  ).href;
  const module = (await importUnknownModule(modulePath)) as {
    readonly SessionRunner: new (
      options?: ClaudeSessionRunnerOptions,
    ) => ClaudeSessionRunnerLike;
  };
  return new module.SessionRunner(options);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }

    const record = toRecord(block);
    if (record === null) {
      continue;
    }

    const textValue = record["text"];
    if (
      typeof textValue === "string" &&
      textValue.length > 0 &&
      (record["type"] === "text" ||
        record["type"] === "output_text" ||
        record["type"] === "input_text")
    ) {
      parts.push(textValue);
    }
  }

  return parts.join("");
}

function extractAssistantText(message: object): string | null {
  const root = toRecord(message);
  if (root === null) {
    return null;
  }

  const topLevelType = typeof root["type"] === "string" ? root["type"] : null;
  const roleFromRoot = typeof root["role"] === "string" ? root["role"] : null;
  const messageRecord = toRecord(root["message"]);
  const roleFromMessage =
    messageRecord !== null && typeof messageRecord["role"] === "string"
      ? messageRecord["role"]
      : null;
  const isAssistant =
    topLevelType === "assistant" ||
    roleFromRoot === "assistant" ||
    roleFromMessage === "assistant";

  if (!isAssistant) {
    return null;
  }

  const contentSource =
    messageRecord?.["content"] ?? root["content"] ?? messageRecord;
  const text = extractTextFromContent(contentSource);
  return text.length === 0 ? null : text;
}

function resolveLocalSessionConfig(
  config: ClaudeAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: ClaudeSessionConfig;
  readonly runnerOptions: ClaudeSessionRunnerOptions;
} {
  const promptText = buildCombinedPromptText(input);
  const env = buildAmbientProcessEnv(
    config.env,
    input.divedraHookContext === undefined
      ? undefined
      : { ...input.divedraHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );

  return {
    promptText,
    sessionConfig: {
      prompt: input.promptText,
      projectPath: config.cwd ?? input.workingDirectory,
      ...(input.systemPromptText === undefined
        ? {}
        : { systemPrompt: input.systemPromptText }),
    },
    runnerOptions: {
      cwd: config.cwd ?? input.workingDirectory,
      model: input.node.model,
      ...(config.permissionMode === undefined
        ? {}
        : { permissionMode: config.permissionMode }),
      ...(config.additionalArgs === undefined
        ? {}
        : { additionalArgs: [...config.additionalArgs] }),
      ...(env === undefined ? {} : { env: { ...env } }),
    },
  };
}

async function executeLocalClaudeCodeAgent(
  config: ClaudeAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  throwIfAborted(context.signal, "claude adapter aborted before start");

  const { promptText, sessionConfig, runnerOptions } =
    resolveLocalSessionConfig(config, input);
  const runner = await (config.createRunner ?? createDefaultRunner)(
    runnerOptions,
  );
  const session =
    input.backendSession?.mode === "reuse" &&
    input.backendSession.sessionId !== undefined
      ? await runner.resumeSession(
          input.backendSession.sessionId,
          input.promptText,
          input.systemPromptText,
        )
      : await runner.startSession(sessionConfig);

  throwIfAborted(context.signal, "claude adapter aborted before execution");

  let responseText = "";
  let lastError: Error | undefined;
  const onError = (error: unknown) => {
    lastError =
      error instanceof Error ? error : new Error(String(error ?? "unknown"));
  };
  session.on("error", onError);
  const disposeAbort = bindAbortSignal(context.signal, async () => {
    await session.cancel();
  });

  try {
    for await (const message of session.messages()) {
      const assistantText = extractAssistantText(message);
      if (assistantText !== null) {
        responseText = assistantText;
      }
    }

    const result = await session.waitForCompletion();
    if (!result.success) {
      if (context.signal.aborted) {
        throw new AdapterExecutionError(
          "timeout",
          "claude adapter aborted by timeout",
        );
      }
      throw new AdapterExecutionError(
        "provider_error",
        lastError?.message ??
          `claude agent session '${session.sessionId}' failed`,
      );
    }

    throwIfAborted(context.signal, "claude adapter aborted after completion");
    return buildLocalAdapterOutput(
      {
        node: input.node,
        output: input.output,
      },
      {
        provider: "claude-code-agent",
        promptText,
        responseText,
        backendSessionId: session.sessionId,
      },
    );
  } finally {
    disposeAbort();
    session.removeListener("error", onError);
  }
}

export class ClaudeCodeAgentAdapter implements NodeAdapter {
  readonly #config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);

    return await executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () =>
        await executeLocalClaudeCodeAgent(this.#config, input, context),
      normalizeError: (error) =>
        error instanceof DOMException && error.name === "AbortError"
          ? new AdapterExecutionError(
              "timeout",
              "claude adapter aborted by timeout",
            )
          : normalizeAdapterFailure(error, "unknown claude adapter failure"),
    });
  }
}

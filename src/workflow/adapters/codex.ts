import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "../adapter";
import {
  createWatchedLlmSession,
  type LlmSessionStallWatchConfig,
} from "./llm-session-stall-watch";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  throwIfAborted,
  withProcessEnvOverride,
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";

type CodexSandboxMode = "full" | "network-only" | "none";
type CodexApprovalMode =
  | "always"
  | "unless-allow-listed"
  | "never"
  | "on-failure";

interface CodexSessionRunnerOptions {
  readonly codexBinary?: string;
  readonly codexHome?: string;
}

interface CodexSessionConfig {
  readonly prompt: string;
  readonly cwd?: string;
  readonly sandbox?: CodexSandboxMode;
  readonly approvalMode?: CodexApprovalMode;
  readonly fullAuto?: boolean;
  readonly model?: string;
  readonly additionalArgs?: readonly string[];
  readonly images?: readonly string[];
  readonly streamGranularity?: "event" | "char";
}

interface CodexSessionResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly messageCount: number;
  };
}

type CodexNormalizedEvent =
  | {
      readonly type: "session.started";
      readonly sessionId: string;
    }
  | {
      readonly type: "assistant.snapshot";
      readonly sessionId: string;
      readonly content: string;
    }
  | {
      readonly type: "session.error";
      readonly sessionId?: string;
      readonly error: Error;
    };

interface CodexRunningSessionLike {
  readonly sessionId: string;
  messages(): AsyncIterable<unknown>;
  waitForCompletion(): Promise<CodexSessionResult>;
  cancel(): Promise<void>;
}

interface CodexSessionRunnerLike {
  startSession(config: CodexSessionConfig): Promise<CodexRunningSessionLike>;
  resumeSession(
    sessionId: string,
    prompt?: string,
    options?: Omit<CodexSessionConfig, "prompt">,
  ): Promise<CodexRunningSessionLike>;
}

type CodexRunnerFactory = (
  options: CodexSessionRunnerOptions,
) => CodexSessionRunnerLike | Promise<CodexSessionRunnerLike>;

export interface CodexAdapterConfig extends LlmSessionStallWatchConfig {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly cwd?: string;
  readonly codexBinary?: string;
  readonly codexHome?: string;
  readonly sandbox?: CodexSandboxMode;
  readonly approvalMode?: CodexApprovalMode;
  readonly fullAuto?: boolean;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: CodexRunnerFactory;
}

const importUnknownModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

async function createDefaultRunner(
  options: CodexSessionRunnerOptions,
): Promise<CodexSessionRunnerLike> {
  const module = (await importUnknownModule("codex-agent")) as {
    readonly SessionRunner: new (
      options?: CodexSessionRunnerOptions,
    ) => CodexSessionRunnerLike;
  };
  return new module.SessionRunner(options);
}

async function toCodexNormalizedEvents(
  chunks: AsyncIterable<unknown>,
): Promise<AsyncIterable<CodexNormalizedEvent>> {
  const module = (await importUnknownModule("codex-agent")) as {
    readonly toNormalizedEvents: (
      input: AsyncIterable<unknown>,
    ) => AsyncIterable<CodexNormalizedEvent>;
  };
  return module.toNormalizedEvents(chunks);
}

function resolveLocalSessionConfig(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: CodexSessionConfig;
} {
  const promptText = buildCombinedPromptText(input);
  return {
    promptText,
    sessionConfig: {
      prompt: promptText,
      cwd: config.cwd ?? input.workingDirectory,
      model: input.node.model,
      ...(config.sandbox === undefined ? {} : { sandbox: config.sandbox }),
      ...(config.approvalMode === undefined
        ? {}
        : { approvalMode: config.approvalMode }),
      ...(config.fullAuto === undefined ? {} : { fullAuto: config.fullAuto }),
      ...(config.additionalArgs === undefined
        ? {}
        : { additionalArgs: config.additionalArgs }),
      streamGranularity: "event",
    },
  };
}

function buildResumeSessionOptions(
  sessionConfig: CodexSessionConfig,
): Omit<CodexSessionConfig, "prompt"> {
  return {
    ...(sessionConfig.cwd === undefined ? {} : { cwd: sessionConfig.cwd }),
    ...(sessionConfig.model === undefined
      ? {}
      : { model: sessionConfig.model }),
    ...(sessionConfig.sandbox === undefined
      ? {}
      : { sandbox: sessionConfig.sandbox }),
    ...(sessionConfig.approvalMode === undefined
      ? {}
      : { approvalMode: sessionConfig.approvalMode }),
    ...(sessionConfig.fullAuto === undefined
      ? {}
      : { fullAuto: sessionConfig.fullAuto }),
    ...(sessionConfig.additionalArgs === undefined
      ? {}
      : { additionalArgs: sessionConfig.additionalArgs }),
    ...(sessionConfig.images === undefined
      ? {}
      : { images: sessionConfig.images }),
    ...(sessionConfig.streamGranularity === undefined
      ? {}
      : { streamGranularity: sessionConfig.streamGranularity }),
  };
}

function isCodexEvent(value: unknown): value is CodexNormalizedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

function stringifyUnknown(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

async function executeLocalCodexAgent(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  throwIfAborted(context.signal, "codex adapter aborted before start");

  const runner = await (config.createRunner ?? createDefaultRunner)({
    ...(config.codexBinary === undefined
      ? {}
      : { codexBinary: config.codexBinary }),
    ...(config.codexHome === undefined ? {} : { codexHome: config.codexHome }),
  });
  const { promptText, sessionConfig } = resolveLocalSessionConfig(
    config,
    input,
  );
  const ambientEnv = buildAmbientProcessEnv(
    config.env,
    input.divedraHookContext === undefined
      ? undefined
      : { ...input.divedraHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );

  const session = await withProcessEnvOverride(ambientEnv, async () => {
    if (
      input.backendSession?.mode === "reuse" &&
      input.backendSession.sessionId !== undefined
    ) {
      return await runner.resumeSession(
        input.backendSession.sessionId,
        promptText,
        buildResumeSessionOptions(sessionConfig),
      );
    }
    return await runner.startSession(sessionConfig);
  });

  throwIfAborted(context.signal, "codex adapter aborted before execution");

  let responseText = "";
  let sessionId = session.sessionId;
  let lastError: Error | undefined;
  const llmMessages: AdapterLlmSessionMessage[] = [];
  const processLogs: AdapterProcessLog[] = [];
  const disposeAbort = bindAbortSignal(context.signal, async () => {
    await session.cancel();
  });
  const watchedSession = createWatchedLlmSession<
    CodexRunningSessionLike,
    CodexSessionResult
  >({
    provider: "codex-agent",
    primarySession: session,
    signal: context.signal,
    stallWatch: config,
    resumeSession: async (targetSessionId, prompt) =>
      await runner.resumeSession(
        targetSessionId,
        prompt,
        buildResumeSessionOptions(sessionConfig),
      ),
    isResultSuccess: (result) => result.success,
    describeResult: (result) =>
      `success=${result.success} exitCode=${result.exitCode} messages=${result.stats.messageCount}`,
    onProcessLog: (log) => {
      processLogs.push(log);
    },
  });

  try {
    const events = await toCodexNormalizedEvents(watchedSession.messages);
    for await (const event of events) {
      if (!isCodexEvent(event)) {
        continue;
      }
      switch (event.type) {
        case "session.started":
          sessionId = event.sessionId;
          break;
        case "assistant.snapshot": {
          responseText = event.content;
          const rawMessageJson = stringifyUnknown(event);
          llmMessages.push({
            ordinal: llmMessages.length + 1,
            eventType: event.type,
            role: "assistant",
            contentText: event.content,
            backendSessionId: sessionId,
            at: new Date().toISOString(),
            ...(rawMessageJson === undefined ? {} : { rawMessageJson }),
          });
          break;
        }
        case "session.error":
          lastError = event.error;
          break;
      }
    }

    const result = await watchedSession.waitForCompletion();
    if (!result.success) {
      if (context.signal.aborted) {
        throw new AdapterExecutionError(
          "timeout",
          "codex adapter aborted by timeout",
        );
      }
      throw new AdapterExecutionError(
        "provider_error",
        lastError?.message ??
          `codex agent session '${sessionId}' failed with exit code ${result.exitCode}`,
      );
    }

    throwIfAborted(context.signal, "codex adapter aborted after completion");
    const output = buildLocalAdapterOutput(
      {
        node: input.node,
        output: input.output,
      },
      {
        provider: "codex-agent",
        promptText,
        responseText,
        backendSessionId: sessionId,
        llmMessages,
      },
    );
    return processLogs.length === 0 ? output : { ...output, processLogs };
  } finally {
    watchedSession.stop();
    disposeAbort();
  }
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
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);

    return await executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () =>
        await executeLocalCodexAgent(this.#config, input, context),
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

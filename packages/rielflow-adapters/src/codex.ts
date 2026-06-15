import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "rielflow-core";
import {
  type AgentNormalizedChunkEvent,
  type ApprovalMode,
  type SandboxMode,
  type SessionConfig as CodexSessionConfig,
  type SessionResult as CodexSessionResult,
  SessionRunner,
  type SessionRunnerOptions as CodexSessionRunnerOptions,
  type SessionStreamChunk,
  toNormalizedEvents,
} from "codex-agent/sdk";
import {
  type LlmSessionStallWatchConfig,
} from "./llm-session-stall-watch";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  createWatchedLocalAgentSession,
  resolveAdapterImagePaths,
  throwIfAborted,
  withProcessEnvOverride,
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";
import { getCodexBackendLoginStatus } from "./readiness";

interface CodexRunningSessionLike {
  readonly sessionId: string;
  messages(): AsyncIterable<SessionStreamChunk>;
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
  readonly authPreflight?: boolean;
  readonly authPreflightTimeoutMs?: number;
  readonly cwd?: string;
  readonly codexBinary?: string;
  readonly codexHome?: string;
  readonly sandbox?: SandboxMode;
  readonly approvalMode?: ApprovalMode;
  readonly fullAuto?: boolean;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: CodexRunnerFactory;
  readonly checkAuthPreflight?: (
    input: AdapterExecutionInput,
    options: {
      readonly codexBinary?: string;
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly timeoutMs?: number;
    },
  ) => Promise<void>;
}

const DEFAULT_AUTH_PREFLIGHT_TIMEOUT_MS = 5_000;

function buildCodexReasoningEffortOverride(
  effort: string | undefined,
): string | undefined {
  return effort === undefined
    ? undefined
    : `model_reasoning_effort="${effort}"`;
}

function readStringArrayVariable(
  variables: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  const value = variables[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value.filter((entry) => typeof entry === "string");
  return entries.length === 0 ? undefined : entries;
}

function mergeAdditionalArgs(
  configArgs: readonly string[] | undefined,
  nodeArgs: readonly string[] | undefined,
): readonly string[] | undefined {
  const merged = [...(configArgs ?? []), ...(nodeArgs ?? [])];
  return merged.length === 0 ? undefined : merged;
}

async function createDefaultRunner(
  options: CodexSessionRunnerOptions,
): Promise<CodexSessionRunnerLike> {
  return new SessionRunner(options);
}

function shouldRunAuthPreflight(config: CodexAdapterConfig): boolean {
  if (config.authPreflight !== undefined) {
    return config.authPreflight;
  }
  return config.checkAuthPreflight !== undefined || config.createRunner === undefined;
}

async function runCodexAuthPreflight(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
): Promise<void> {
  if (!shouldRunAuthPreflight(config)) {
    return;
  }
  const env = buildAmbientProcessEnv(
    config.env,
    input.rielflowHookContext === undefined
      ? undefined
      : { ...input.rielflowHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );
  const options = {
    ...(config.codexBinary === undefined
      ? {}
      : { codexBinary: config.codexBinary }),
    cwd: config.cwd ?? input.workingDirectory,
    ...(env === undefined ? {} : { env }),
    timeoutMs: config.authPreflightTimeoutMs ?? DEFAULT_AUTH_PREFLIGHT_TIMEOUT_MS,
  };
  if (config.checkAuthPreflight !== undefined) {
    await config.checkAuthPreflight(input, options);
    return;
  }
  const status = await getCodexBackendLoginStatus(options);
  if (!status.ok) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `codex-agent authentication is unavailable: ${status.error ?? status.status ?? "login status failed"}`,
    );
  }
}

async function toCodexNormalizedEvents(
  chunks: AsyncIterable<SessionStreamChunk>,
): Promise<AsyncIterable<AgentNormalizedChunkEvent>> {
  return toNormalizedEvents(chunks);
}

function resolveLocalSessionConfig(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: CodexSessionConfig;
} {
  const promptText = buildCombinedPromptText(input);
  const reasoningEffortOverride = buildCodexReasoningEffortOverride(
    input.node.effort,
  );
  const images = resolveAdapterImagePaths(input);
  const additionalArgs = mergeAdditionalArgs(
    config.additionalArgs,
    readStringArrayVariable(input.node.variables, "codexAdditionalArgs"),
  );
  return {
    promptText,
    sessionConfig: {
      prompt: input.promptText,
      ...(input.systemPromptText === undefined
        ? {}
        : { systemPrompt: input.systemPromptText }),
      cwd: config.cwd ?? input.workingDirectory,
      model: input.node.model,
      sandbox: config.sandbox !== undefined ? config.sandbox : "danger-full-access",
      approvalMode: config.approvalMode !== undefined ? config.approvalMode : "never",
      fullAuto: config.fullAuto !== undefined ? config.fullAuto : true,
      ...(additionalArgs === undefined ? {} : { additionalArgs }),
      ...(reasoningEffortOverride === undefined
        ? {}
        : { configOverrides: [reasoningEffortOverride] }),
      ...(images.length === 0 ? {} : { images }),
      streamGranularity: "event",
    },
  };
}

function buildResumeSessionOptions(
  sessionConfig: CodexSessionConfig,
): Omit<CodexSessionConfig, "prompt"> {
  return {
    ...(sessionConfig.cwd === undefined ? {} : { cwd: sessionConfig.cwd }),
    ...(sessionConfig.systemPrompt === undefined
      ? {}
      : { systemPrompt: sessionConfig.systemPrompt }),
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
    ...(sessionConfig.configOverrides === undefined
      ? {}
      : { configOverrides: sessionConfig.configOverrides }),
    ...(sessionConfig.images === undefined
      ? {}
      : { images: sessionConfig.images }),
    ...(sessionConfig.streamGranularity === undefined
      ? {}
      : { streamGranularity: sessionConfig.streamGranularity }),
  };
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
    input.rielflowHookContext === undefined
      ? undefined
      : { ...input.rielflowHookContext.environment },
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
        input.promptText,
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
  const watchedSession = createWatchedLocalAgentSession<
    CodexRunningSessionLike,
    CodexSessionResult,
    SessionStreamChunk
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
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy({
      ...this.#config,
      defaultMaxAttempts: 1,
    });

    return await executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        await runCodexAuthPreflight(this.#config, input);
        return await executeLocalCodexAgent(this.#config, input, context);
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
